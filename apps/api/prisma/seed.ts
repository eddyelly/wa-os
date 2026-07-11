// Dev seed: a demo Organization, its OWNER User, and a sample KnowledgeDoc
// with chunks (embeddings arrive via the embeddings queue in Milestone 2).
// Idempotent: safe to run repeatedly.
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

const DEMO_EMAIL = 'demo@waos.dev';
const DEMO_PASSWORD = 'DemoOwner123!';

const DOC_TITLE = 'Huduma na bei (services and prices)';
const DOC_CONTENT = [
  'Nuru Salon, Kariakoo, Dar es Salaam.',
  'Saa za kazi: Jumatatu mpaka Jumamosi, saa 3 asubuhi (9:00) mpaka saa 1 jioni (19:00). Jumapili tumefunga.',
  'Huduma na bei: kusuka rasta TZS 25,000; kupaka rangi TZS 40,000; kunyoa na kuchana TZS 10,000; manicure TZS 15,000.',
  'Opening hours: Monday to Saturday, 9:00 to 19:00. Closed on Sunday.',
  'Services and prices: braiding TZS 25,000; hair coloring TZS 40,000; haircut and styling TZS 10,000; manicure TZS 15,000.',
  'Tunapokea miadi kwa WhatsApp. Karibu sana!',
].join('\n');

// No embeddings at seed time; they arrive when products are edited via the
// API or re-embedded through the embeddings queue.
const demoProducts = [
  {
    name: 'Mafuta ya nywele (hair oil)',
    description: 'Natural coconut hair oil, 250ml bottle.',
    price: 12000,
    minPrice: 9000,
    stockQty: 20,
    lowStockThreshold: 5,
  },
  {
    name: 'Wig ya braids (braided wig)',
    description: 'Hand-braided wig, medium length, black.',
    price: 85000,
    minPrice: 70000,
    stockQty: 3,
    lowStockThreshold: 2,
  },
];

async function main(): Promise<void> {
  const existingUser = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });

  const organizationId =
    existingUser?.organizationId ??
    (
      await prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({
          data: {
            name: 'Nuru Salon',
            vertical: 'salon',
            language: 'sw',
            timezone: 'Africa/Dar_es_Salaam',
          },
        });
        await tx.user.create({
          data: {
            organizationId: organization.id,
            email: DEMO_EMAIL,
            passwordHash: await argon2.hash(DEMO_PASSWORD),
            name: 'Neema Juma',
            role: 'OWNER',
          },
        });
        return organization;
      })
    ).id;

  const existingDoc = await prisma.knowledgeDoc.findFirst({
    where: { organizationId, title: DOC_TITLE },
  });

  if (!existingDoc) {
    const doc = await prisma.knowledgeDoc.create({
      data: { organizationId, title: DOC_TITLE, content: DOC_CONTENT },
    });
    const paragraphs = DOC_CONTENT.split('\n');
    await prisma.knowledgeChunk.createMany({
      data: paragraphs.map((content, index) => ({
        organizationId,
        docId: doc.id,
        index,
        content,
      })),
    });
  }

  for (const product of demoProducts) {
    const existingProduct = await prisma.product.findFirst({
      where: { organizationId, name: product.name },
    });
    if (!existingProduct) {
      await prisma.product.create({ data: { organizationId, ...product } });
    }
  }

  console.log('Seed complete.');
  console.log(`  demo login: ${DEMO_EMAIL} / ${DEMO_PASSWORD} (dev only, not a secret)`);
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
