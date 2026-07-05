import { describe, expect, it } from 'vitest';
import { ForbiddenError, MissingTenantContextError } from './errors.js';
import { prisma } from './prisma.js';
import { scopeArgs, scopeOrganizationArgs, TENANT_MODELS } from './tenant.js';

const ORG_A = 'org-a';
const ORG_B = 'org-b';

describe('scopeArgs (tenant query rewriting)', () => {
  it('injects organizationId into findMany where', () => {
    const scoped = scopeArgs('findMany', { where: { status: 'OPEN' } }, ORG_A);
    expect(scoped.where).toEqual({ status: 'OPEN', organizationId: ORG_A });
  });

  it('scopes queries that have no where at all', () => {
    const scoped = scopeArgs('findMany', {}, ORG_A);
    expect(scoped.where).toEqual({ organizationId: ORG_A });
  });

  it('overrides a spoofed organizationId in where: cross-tenant reads fail', () => {
    const scoped = scopeArgs('findMany', { where: { organizationId: ORG_B } }, ORG_A);
    expect(scoped.where).toEqual({ organizationId: ORG_A });
  });

  it('pins unique lookups to the tenant so a foreign row is a miss', () => {
    const scoped = scopeArgs('findUnique', { where: { id: 'contact-of-org-b' } }, ORG_A);
    expect(scoped.where).toEqual({ id: 'contact-of-org-b', organizationId: ORG_A });
  });

  it('forces organizationId on create, overriding a spoofed value', () => {
    const scoped = scopeArgs('create', { data: { phone: '+255700000001', organizationId: ORG_B } }, ORG_A);
    expect(scoped.data).toEqual({ phone: '+255700000001', organizationId: ORG_A });
  });

  it('forces organizationId on every createMany row', () => {
    const scoped = scopeArgs(
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
      'update',
      { where: { id: 'c1' }, data: { name: 'Asha', organizationId: ORG_B } },
      ORG_A,
    );
    expect(scoped.where).toEqual({ id: 'c1', organizationId: ORG_A });
    expect(scoped.data).toEqual({ name: 'Asha' });
  });

  it('scopes deletes and deleteMany', () => {
    expect(scopeArgs('delete', { where: { id: 'c1' } }, ORG_A).where).toEqual({
      id: 'c1',
      organizationId: ORG_A,
    });
    expect(scopeArgs('deleteMany', { where: {} }, ORG_A).where).toEqual({
      organizationId: ORG_A,
    });
  });

  it('scopes upsert on all three surfaces: where, create, update', () => {
    const scoped = scopeArgs(
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
    expect(scopeArgs('count', {}, ORG_A).where).toEqual({ organizationId: ORG_A });
    expect(scopeArgs('groupBy', { by: ['status'] }, ORG_A).where).toEqual({
      organizationId: ORG_A,
    });
  });

  it('covers every domain model in the schema', () => {
    expect([...TENANT_MODELS].sort()).toEqual(
      [
        'AiReplyLog',
        'Appointment',
        'Channel',
        'Contact',
        'Conversation',
        'KnowledgeChunk',
        'KnowledgeDoc',
        'Message',
        'User',
      ].sort(),
    );
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
