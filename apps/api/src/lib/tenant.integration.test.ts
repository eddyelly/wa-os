// Live-database proof that cross-tenant access fails through the tenant
// client. Gated on INTEGRATION_DATABASE_URL (a migrated postgres database);
// run for example with:
//   INTEGRATION_DATABASE_URL=postgresql://waos:waos@localhost:5432/waos_dev pnpm -F @waos/api test
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runWithRequestContext, requireRequestContext } from './context.js';
import { MissingTenantContextError } from './errors.js';
import { createTenantExtension } from './tenant.js';

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

describe.skipIf(!databaseUrl)('tenant isolation (live database)', () => {
  const base = new PrismaClient({ datasourceUrl: databaseUrl });
  const tenantClient = base.$extends(
    createTenantExtension(() => requireRequestContext().organizationId),
  );

  let orgAId = '';
  let orgBId = '';
  let contactAId = '';
  let contactBId = '';

  // Prisma queries are lazy: they execute when awaited. The await must
  // happen inside the AsyncLocalStorage scope, exactly like a real request
  // where the whole handler chain runs inside runWithRequestContext.
  const asOrgA = <T>(fn: () => Promise<T>): Promise<T> =>
    runWithRequestContext({ organizationId: orgAId, userId: 'user-a', role: 'OWNER' }, () =>
      fn().then((value) => value),
    );

  beforeAll(async () => {
    const orgA = await base.organization.create({ data: { name: 'Isolation Test Org A' } });
    const orgB = await base.organization.create({ data: { name: 'Isolation Test Org B' } });
    orgAId = orgA.id;
    orgBId = orgB.id;
    const contactA = await base.contact.create({
      data: { organizationId: orgAId, phone: '+255700000101', name: 'Contact A' },
    });
    const contactB = await base.contact.create({
      data: { organizationId: orgBId, phone: '+255700000102', name: 'Contact B' },
    });
    contactAId = contactA.id;
    contactBId = contactB.id;
  });

  afterAll(async () => {
    await base.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } });
    await base.$disconnect();
  });

  it('findMany only returns the tenant own rows', async () => {
    const contacts = await asOrgA(() => tenantClient.contact.findMany());
    expect(contacts.map((c) => c.id)).toEqual([contactAId]);
  });

  it('findUnique on a foreign row is a miss', async () => {
    const foreign = await asOrgA(() =>
      tenantClient.contact.findUnique({ where: { id: contactBId } }),
    );
    expect(foreign).toBeNull();
    const own = await asOrgA(() => tenantClient.contact.findUnique({ where: { id: contactAId } }));
    expect(own?.id).toBe(contactAId);
  });

  it('a spoofed organizationId filter cannot widen the scope', async () => {
    const contacts = await asOrgA(() =>
      tenantClient.contact.findMany({ where: { organizationId: orgBId } }),
    );
    expect(contacts.map((c) => c.id)).toEqual([contactAId]);
  });

  it('updating a foreign row fails with record-not-found', async () => {
    await expect(
      asOrgA(() =>
        tenantClient.contact.update({ where: { id: contactBId }, data: { name: 'Hijacked' } }),
      ),
    ).rejects.toMatchObject({ code: 'P2025' });
    const untouched = await base.contact.findUnique({ where: { id: contactBId } });
    expect(untouched?.name).toBe('Contact B');
  });

  it('deleting a foreign row fails with record-not-found', async () => {
    await expect(
      asOrgA(() => tenantClient.contact.delete({ where: { id: contactBId } })),
    ).rejects.toMatchObject({ code: 'P2025' });
  });

  it('creates land in the caller tenant even when spoofed', async () => {
    const created = await asOrgA(() =>
      tenantClient.contact.create({
        data: { organizationId: orgBId, phone: '+255700000103', name: 'Spoofed Create' },
      }),
    );
    expect(created.organizationId).toBe(orgAId);
  });

  it('rejects a relation connect that references a foreign row', async () => {
    await expect(
      asOrgA(() =>
        tenantClient.appointment.create({
          data: {
            serviceName: 'Braiding',
            startsAt: new Date('2026-08-01T09:00:00Z'),
            endsAt: new Date('2026-08-01T10:00:00Z'),
            organization: { connect: { id: orgAId } },
            contact: { connect: { id: contactBId } },
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('organization reads are pinned to the tenant own id', async () => {
    const org = await asOrgA(() =>
      tenantClient.organization.findUnique({ where: { id: orgBId } }),
    );
    expect(org?.id).toBe(orgAId);
  });

  it('queries without a request context fail closed', async () => {
    await expect(tenantClient.contact.findMany()).rejects.toBeInstanceOf(
      MissingTenantContextError,
    );
  });
});
