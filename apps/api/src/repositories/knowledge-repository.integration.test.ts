// Retrieval tenant isolation against a live pgvector database. Gated on
// INTEGRATION_DATABASE_URL.
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runWithRequestContext } from '../lib/context.js';
import { knowledgeRepository } from './knowledge-repository.js';

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

// Deterministic fake embeddings: orthogonal unit vectors so similarity is
// exact. dim must match the schema (1536).
function unitVector(hotIndex: number): number[] {
  const vector = new Array<number>(1536).fill(0);
  vector[hotIndex] = 1;
  return vector;
}

describe.skipIf(!databaseUrl)('knowledge retrieval tenant isolation (live database)', () => {
  const base = new PrismaClient({ datasourceUrl: databaseUrl });
  let orgAId = '';
  let orgBId = '';

  const asOrg = <T>(organizationId: string, fn: () => Promise<T>): Promise<T> =>
    runWithRequestContext({ organizationId, userId: 'test', role: 'OWNER' }, () =>
      fn().then((v) => v),
    );

  beforeAll(async () => {
    const orgA = await base.organization.create({ data: { name: 'Retrieval Org A' } });
    const orgB = await base.organization.create({ data: { name: 'Retrieval Org B' } });
    orgAId = orgA.id;
    orgBId = orgB.id;

    const docA = await base.knowledgeDoc.create({
      data: { organizationId: orgAId, title: 'Prices A', content: 'Org A prices' },
    });
    const docB = await base.knowledgeDoc.create({
      data: { organizationId: orgBId, title: 'Prices B', content: 'Org B prices' },
    });

    await asOrg(orgAId, () =>
      knowledgeRepository.insertChunk({
        organizationId: orgAId,
        docId: docA.id,
        index: 0,
        content: 'Braiding costs TZS 25,000 at org A.',
        embedding: unitVector(0),
      }),
    );
    await asOrg(orgBId, () =>
      knowledgeRepository.insertChunk({
        organizationId: orgBId,
        docId: docB.id,
        index: 0,
        content: 'Braiding costs TZS 99,000 at org B.',
        embedding: unitVector(0),
      }),
    );
  });

  afterAll(async () => {
    await base.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } });
    await base.$disconnect();
  });

  it('returns only the calling organization chunks, even for identical vectors', async () => {
    const results = await asOrg(orgAId, () => knowledgeRepository.searchChunks(unitVector(0), 10));
    expect(results.length).toBe(1);
    expect(results[0]?.content).toContain('org A');
  });

  it('applies the relevance floor', async () => {
    const results = await asOrg(orgAId, () =>
      knowledgeRepository.searchChunks(unitVector(7), 10, 0.35),
    );
    expect(results).toEqual([]);
  });

  it('fails closed without a tenant context', async () => {
    await expect(knowledgeRepository.searchChunks(unitVector(0), 5)).rejects.toMatchObject({
      code: 'TENANT_CONTEXT_MISSING',
    });
  });
});
