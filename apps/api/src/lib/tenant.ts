import { Prisma } from '@prisma/client';
import { ForbiddenError } from './errors.js';

/**
 * Tenant safety (CLAUDE.md section 2, rule 5).
 *
 * Every domain model carries organizationId. This extension injects the
 * authenticated organization into every query so a request can only ever
 * touch its own tenant's rows:
 *
 * - reads and writes get organizationId merged into `where` (this includes
 *   unique lookups: Prisma allows extra filters on unique where inputs, so a
 *   cross-tenant findUnique/update/delete simply misses)
 * - creates get organizationId forced into `data`, overriding any value the
 *   caller supplied
 * - updates get organizationId stripped from `data` so a row can never move
 *   between tenants
 * - Organization itself is scoped by id, and cannot be created through the
 *   tenant client (signup owns that, pre-auth, in a transaction)
 *
 * If no request context is present the resolver throws, so unscoped access
 * fails closed. Repositories must not use nested writes that create rows for
 * a different model (create the rows directly instead) because nested create
 * data is not rewritten by this extension.
 */

export const TENANT_MODELS = new Set<string>([
  'User',
  'Channel',
  'Contact',
  'Conversation',
  'Message',
  'KnowledgeDoc',
  'KnowledgeChunk',
  'Appointment',
  'AiReplyLog',
]);

type QueryArgs = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeWhere(args: QueryArgs, filter: Record<string, unknown>): QueryArgs {
  const where = isRecord(args.where) ? args.where : {};
  // Top-level sibling keys are AND semantics in Prisma, and the tenant filter
  // overrides any caller-supplied value for the same key.
  return { ...args, where: { ...where, ...filter } };
}

function forceData(data: unknown, organizationId: string): unknown {
  if (Array.isArray(data)) {
    const items: readonly unknown[] = data;
    return items.map((item) => (isRecord(item) ? { ...item, organizationId } : item));
  }
  if (isRecord(data)) {
    // A relation-style `organization: { connect: ... }` would conflict with
    // the scalar we set here and make Prisma reject the query: failing closed.
    return { ...data, organizationId };
  }
  return data;
}

function stripOrganizationFromUpdate(data: unknown): unknown {
  if (!isRecord(data)) {
    return data;
  }
  const { organizationId: _organizationId, organization: _organization, ...rest } = data;
  return rest;
}

const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn']);
const UPDATE_OPERATIONS = new Set(['update', 'updateMany', 'updateManyAndReturn']);
const WHERE_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
  'upsert',
]);

/**
 * Pure argument rewrite for a tenant-scoped operation; exported so unit tests
 * can prove cross-tenant access fails without a database.
 */
export function scopeArgs(operation: string, args: QueryArgs, organizationId: string): QueryArgs {
  let scoped: QueryArgs = { ...args };

  if (WHERE_OPERATIONS.has(operation)) {
    scoped = mergeWhere(scoped, { organizationId });
  }
  if (CREATE_OPERATIONS.has(operation) && 'data' in scoped) {
    scoped = { ...scoped, data: forceData(scoped.data, organizationId) };
  }
  if (UPDATE_OPERATIONS.has(operation) && 'data' in scoped) {
    scoped = { ...scoped, data: stripOrganizationFromUpdate(scoped.data) };
  }
  if (operation === 'upsert') {
    scoped = {
      ...scoped,
      create: forceData(scoped.create, organizationId),
      update: stripOrganizationFromUpdate(scoped.update),
    };
  }

  return scoped;
}

/**
 * Argument rewrite for the Organization model itself: reads and updates are
 * pinned to the tenant's own id; creating or deleting organizations through
 * the tenant client is not allowed.
 */
export function scopeOrganizationArgs(
  operation: string,
  args: QueryArgs,
  organizationId: string,
): QueryArgs {
  if (CREATE_OPERATIONS.has(operation) || operation === 'upsert') {
    throw new ForbiddenError('Organizations are created during signup.');
  }
  if (operation === 'delete' || operation === 'deleteMany') {
    throw new ForbiddenError('Organizations cannot be deleted from the app.');
  }
  let scoped: QueryArgs = { ...args };
  if (WHERE_OPERATIONS.has(operation)) {
    scoped = mergeWhere(scoped, { id: organizationId });
  }
  if (UPDATE_OPERATIONS.has(operation) && 'data' in scoped) {
    scoped = { ...scoped, data: stripOrganizationFromUpdate(scoped.data) };
  }
  return scoped;
}

export function createTenantExtension(resolveOrganizationId: () => string) {
  return Prisma.defineExtension({
    name: 'tenant-scope',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          const organizationId = resolveOrganizationId();
          if (model === 'Organization') {
            return query(scopeOrganizationArgs(operation, args, organizationId));
          }
          if (!TENANT_MODELS.has(model)) {
            return query(args);
          }
          return query(scopeArgs(operation, args, organizationId));
        },
      },
    },
  });
}
