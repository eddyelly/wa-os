/**
 * Re-embeds every knowledge doc for every organization, one embeddings job
 * per doc. Run after switching embedding providers (vector spaces are not
 * compatible across providers). Usage: pnpm -F @waos/api re-embed
 */
import { basePrisma } from '../src/lib/prisma.js';
import { runWithRequestContext } from '../src/lib/context.js';
import { closeQueues, enqueueEmbeddings } from '../src/lib/queues.js';
import { redis } from '../src/lib/redis.js';

async function main(): Promise<void> {
  const docs = await basePrisma.knowledgeDoc.findMany({
    select: { id: true, organizationId: true },
  });
  for (const doc of docs) {
    await runWithRequestContext(
      { organizationId: doc.organizationId, userId: 'script:re-embed', role: 'OWNER' },
      () => enqueueEmbeddings({ organizationId: doc.organizationId, docId: doc.id }),
    );
  }
  console.log(`Enqueued re-embedding for ${docs.length} docs.`);
  // closeQueues() only closes the BullMQ Queue instances; lib/redis.ts also
  // holds an eagerly connected, non-lazy ioredis client (imported
  // transitively via lib/queues.ts) that keeps the event loop alive on its
  // own, so it needs its own quit() to let the script exit (see the same
  // pattern in src/index.ts's shutdown handler).
  await closeQueues();
  await redis.quit();
  await basePrisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
