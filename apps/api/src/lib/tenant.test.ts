import { describe, expect, it } from 'vitest';
import { ForbiddenError, MissingTenantContextError } from './errors.js';
import { prisma } from './prisma.js';
import {
  scopeArgs,
  scopeOrganizationArgs,
  TENANT_MODELS,
  TENANT_RELATION_FIELDS,
} from './tenant.js';

const ORG_A = 'org-a';
const ORG_B = 'org-b';

describe('scopeArgs (tenant query rewriting)', () => {
  it('injects organizationId into findMany where', () => {
    const scoped = scopeArgs('Conversation', 'findMany', { where: { status: 'OPEN' } }, ORG_A);
    expect(scoped.where).toEqual({ status: 'OPEN', organizationId: ORG_A });
  });

  it('scopes queries that have no where at all', () => {
    const scoped = scopeArgs('Contact', 'findMany', {}, ORG_A);
    expect(scoped.where).toEqual({ organizationId: ORG_A });
  });

  it('overrides a spoofed organizationId in where: cross-tenant reads fail', () => {
    const scoped = scopeArgs('Contact', 'findMany', { where: { organizationId: ORG_B } }, ORG_A);
    expect(scoped.where).toEqual({ organizationId: ORG_A });
  });

  it('keeps the tenant filter when the caller uses AND/OR blocks', () => {
    const scoped = scopeArgs(
      'Contact',
      'findMany',
      { where: { OR: [{ name: 'Asha' }, { organizationId: ORG_B }] } },
      ORG_A,
    );
    expect(scoped.where).toEqual({
      OR: [{ name: 'Asha' }, { organizationId: ORG_B }],
      organizationId: ORG_A,
    });
  });

  it('pins unique lookups to the tenant so a foreign row is a miss', () => {
    const scoped = scopeArgs('Contact', 'findUnique', { where: { id: 'contact-of-org-b' } }, ORG_A);
    expect(scoped.where).toEqual({ id: 'contact-of-org-b', organizationId: ORG_A });
  });

  it('forces organizationId on create, overriding a spoofed value', () => {
    const scoped = scopeArgs(
      'Contact',
      'create',
      { data: { phone: '+255700000001', organizationId: ORG_B } },
      ORG_A,
    );
    expect(scoped.data).toEqual({ phone: '+255700000001', organizationId: ORG_A });
  });

  it('forces organizationId on every createMany row', () => {
    const scoped = scopeArgs(
      'Contact',
      'createMany',
      { data: [{ phone: '+255700000001' }, { phone: '+255700000002', organizationId: ORG_B }] },
      ORG_A,
    );
    expect(scoped.data).toEqual([
      { phone: '+255700000001', organizationId: ORG_A },
      { phone: '+255700000002', organizationId: ORG_A },
    ]);
  });

  it('strips organizationId from update data so rows cannot switch tenants', () => {
    const scoped = scopeArgs(
      'Contact',
      'update',
      { where: { id: 'c1' }, data: { name: 'Asha', organizationId: ORG_B } },
      ORG_A,
    );
    expect(scoped.where).toEqual({ id: 'c1', organizationId: ORG_A });
    expect(scoped.data).toEqual({ name: 'Asha' });
  });

  it('scopes deletes and deleteMany', () => {
    expect(scopeArgs('Contact', 'delete', { where: { id: 'c1' } }, ORG_A).where).toEqual({
      id: 'c1',
      organizationId: ORG_A,
    });
    expect(scopeArgs('Contact', 'deleteMany', { where: {} }, ORG_A).where).toEqual({
      organizationId: ORG_A,
    });
  });

  it('scopes upsert on all three surfaces: where, create, update', () => {
    const scoped = scopeArgs(
      'Contact',
      'upsert',
      {
        where: { id: 'c1' },
        create: { phone: '+255700000001', organizationId: ORG_B },
        update: { name: 'Asha', organizationId: ORG_B },
      },
      ORG_A,
    );
    expect(scoped.where).toEqual({ id: 'c1', organizationId: ORG_A });
    expect(scoped.create).toEqual({ phone: '+255700000001', organizationId: ORG_A });
    expect(scoped.update).toEqual({ name: 'Asha' });
  });

  it('scopes counts and aggregates', () => {
    expect(scopeArgs('Contact', 'count', {}, ORG_A).where).toEqual({ organizationId: ORG_A });
    expect(scopeArgs('Conversation', 'groupBy', { by: ['status'] }, ORG_A).where).toEqual({
      organizationId: ORG_A,
    });
  });

  it('covers every domain model in the schema', () => {
    const expected = [
      'AiReplyLog',
      'Appointment',
      'Channel',
      'Contact',
      'Conversation',
      'KnowledgeChunk',
      'KnowledgeDoc',
      'Message',
      'Notification',
      'Order',
      'OrderItem',
      'Product',
      'ProductImage',
      'User',
    ];
    expect([...TENANT_MODELS].sort()).toEqual(expected);
    expect(Object.keys(TENANT_RELATION_FIELDS).sort()).toEqual(expected);
  });
});

describe('nested relation writes are rejected', () => {
  it('rejects a nested create through a relation field', () => {
    expect(() =>
      scopeArgs(
        'Contact',
        'create',
        { data: { phone: '+255700000001', conversations: { create: [{ channelId: 'ch1' }] } } },
        ORG_A,
      ),
    ).toThrow(ForbiddenError);
  });

  it('rejects a relation connect that could reference a foreign row', () => {
    expect(() =>
      scopeArgs(
        'Message',
        'create',
        {
          data: {
            direction: 'OUT',
            authorType: 'AI',
            conversation: { connect: { id: 'conversation-of-org-b' } },
          },
        },
        ORG_A,
      ),
    ).toThrow(ForbiddenError);
  });

  it('rejects an organization relation write on create', () => {
    expect(() =>
      scopeArgs(
        'Contact',
        'create',
        { data: { phone: '+255700000001', organization: { connect: { id: ORG_B } } } },
        ORG_A,
      ),
    ).toThrow(ForbiddenError);
  });

  it('rejects relation writes inside update and upsert data', () => {
    expect(() =>
      scopeArgs(
        'Conversation',
        'update',
        { where: { id: 'c1' }, data: { assignee: { connect: { id: 'user-of-org-b' } } } },
        ORG_A,
      ),
    ).toThrow(ForbiddenError);
    expect(() =>
      scopeArgs(
        'Appointment',
        'upsert',
        {
          where: { id: 'a1' },
          create: { serviceName: 'Cut', contact: { connect: { id: 'contact-of-org-b' } } },
          update: {},
        },
        ORG_A,
      ),
    ).toThrow(ForbiddenError);
  });

  it('still allows plain Json object fields like customFields', () => {
    const scoped = scopeArgs(
      'Contact',
      'create',
      { data: { phone: '+255700000001', customFields: { source: 'walk-in' } } },
      ORG_A,
    );
    expect(scoped.data).toEqual({
      phone: '+255700000001',
      customFields: { source: 'walk-in' },
      organizationId: ORG_A,
    });
  });
});

describe('scopeOrganizationArgs (the tenant root)', () => {
  it('pins reads to the tenant own id, overriding a spoofed id', () => {
    const scoped = scopeOrganizationArgs('findUnique', { where: { id: ORG_B } }, ORG_A);
    expect(scoped.where).toEqual({ id: ORG_A });
  });

  it('refuses to create organizations through the tenant client', () => {
    expect(() => scopeOrganizationArgs('create', { data: { name: 'X' } }, ORG_A)).toThrow(
      ForbiddenError,
    );
  });

  it('refuses to delete organizations through the tenant client', () => {
    expect(() => scopeOrganizationArgs('delete', { where: { id: ORG_A } }, ORG_A)).toThrow(
      ForbiddenError,
    );
  });
});

describe('tenant client outside a request context', () => {
  it('fails closed with MissingTenantContextError before touching the database', async () => {
    await expect(prisma.contact.findMany()).rejects.toBeInstanceOf(MissingTenantContextError);
  });
});
