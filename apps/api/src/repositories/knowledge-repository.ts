import { randomUUID } from 'node:crypto';
import { Prisma, type KnowledgeDoc } from '@prisma/client';
import { requireRequestContext } from '../lib/context.js';
import { basePrisma, prisma } from '../lib/prisma.js';

export interface RetrievedChunk {
  id: string;
  docId: string;
  content: string;
  score: number;
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

export const knowledgeRepository = {
  createDoc(data: { title: string; content: string; mimeType: string }): Promise<KnowledgeDoc> {
    return prisma.knowledgeDoc.create({
      data: { ...data, organizationId: requireRequestContext().organizationId },
    });
  },

  findDocById(id: string): Promise<KnowledgeDoc | null> {
    return prisma.knowledgeDoc.findUnique({ where: { id } });
  },

  listDocs(): Promise<(KnowledgeDoc & { _count: { chunks: number } })[]> {
    return prisma.knowledgeDoc.findMany({
      include: { _count: { select: { chunks: true } } },
      orderBy: { createdAt: 'desc' },
    });
  },

  async countEmbeddedByDoc(docIds: string[]): Promise<Map<string, number>> {
    if (docIds.length === 0) {
      return new Map();
    }
    const { organizationId } = requireRequestContext();
    // Raw SQL because Prisma cannot filter on the Unsupported vector column.
    const rows = await basePrisma.$queryRaw<{ docId: string; count: bigint }[]>(
      Prisma.sql`
        SELECT "docId", COUNT(*) AS count
        FROM "KnowledgeChunk"
        WHERE "organizationId" = ${organizationId}
          AND "docId" IN (${Prisma.join(docIds)})
          AND embedding IS NOT NULL
        GROUP BY "docId"
      `,
    );
    return new Map(rows.map((row) => [row.docId, Number(row.count)]));
  },

  deleteDoc(id: string): Promise<KnowledgeDoc> {
    return prisma.knowledgeDoc.delete({ where: { id } });
  },

  async deleteChunksForDoc(docId: string): Promise<void> {
    await prisma.knowledgeChunk.deleteMany({ where: { docId } });
  },

  /**
   * Insert a chunk with its vector. Raw SQL is required for the pgvector
   * column; the tenant filter is the explicit organizationId bound here
   * (CLAUDE.md: similarity search and vector writes live in the repository
   * layer only, always org-scoped, never $queryRawUnsafe).
   */
  async insertChunk(data: {
    organizationId: string;
    docId: string;
    index: number;
    content: string;
    embedding: number[] | null;
  }): Promise<void> {
    const id = randomUUID();
    if (data.embedding) {
      await basePrisma.$executeRaw(
        Prisma.sql`
          INSERT INTO "KnowledgeChunk"
            (id, "organizationId", "docId", index, content, embedding, "createdAt", "updatedAt")
          VALUES
            (${id}, ${data.organizationId}, ${data.docId}, ${data.index}, ${data.content},
             ${toVectorLiteral(data.embedding)}::vector, now(), now())
        `,
      );
      return;
    }
    await basePrisma.$executeRaw(
      Prisma.sql`
        INSERT INTO "KnowledgeChunk"
          (id, "organizationId", "docId", index, content, "createdAt", "updatedAt")
        VALUES
          (${id}, ${data.organizationId}, ${data.docId}, ${data.index}, ${data.content}, now(), now())
      `,
    );
  },

  /**
   * Top-k cosine similarity, scoped to the calling organization, with a
   * relevance floor so unrelated snippets never reach the prompt.
   */
  async searchChunks(queryEmbedding: number[], k = 6, floor = 0.35): Promise<RetrievedChunk[]> {
    const { organizationId } = requireRequestContext();
    const vector = toVectorLiteral(queryEmbedding);
    const rows = await basePrisma.$queryRaw<
      { id: string; docId: string; content: string; score: number }[]
    >(
      Prisma.sql`
        SELECT id, "docId", content, 1 - (embedding <=> ${vector}::vector) AS score
        FROM "KnowledgeChunk"
        WHERE "organizationId" = ${organizationId} AND embedding IS NOT NULL
        ORDER BY embedding <=> ${vector}::vector
        LIMIT ${k}
      `,
    );
    return rows.filter((row) => row.score >= floor);
  },
};
