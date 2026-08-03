import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The sourcing module records what the owner PAYS for goods. That is the most
 * commercially sensitive data in the system, so it must never reach the
 * customer-facing AI. These tests pin that guarantee structurally.
 *
 * Every assertion first proves it is looking at real content: a guard that
 * silently matches nothing is worse than no guard at all.
 */

/** A model's body, located without depending on the order models appear in. */
function modelBody(schema: string, modelName: string): string {
  const header = `model ${modelName} {`;
  const start = schema.indexOf(header);
  expect(start, `${modelName} not found in schema.prisma`).toBeGreaterThanOrEqual(0);
  const end = schema.indexOf('\n}', start);
  expect(end, `${modelName} block is not closed`).toBeGreaterThan(start);
  return schema.slice(start, end);
}

/** Every file that can put text in front of the model or into its tool loop. */
const AI_PATH_FILES = [
  'src/services/shop-tools.ts',
  'src/services/ai-agent.ts',
  'src/services/ai-reply.ts',
  'src/workers/ai-reply-worker.ts',
];

describe('sourcing data never reaches the AI', () => {
  it('mentions nothing about sourcing anywhere in the AI path', () => {
    for (const file of AI_PATH_FILES) {
      const source = readFileSync(file, 'utf8');
      // A typo in the path would otherwise pass every assertion below.
      expect(source.length, `${file} is empty`).toBeGreaterThan(0);
      expect(source, `${file} references sourcing data`).not.toMatch(/sourc(ed|ing)/i);
      expect(source, `${file} references suppliers`).not.toMatch(/supplier/i);
    }
  });

  it('gives no sourcing model an embedding column', () => {
    const schema = readFileSync('prisma/schema.prisma', 'utf8');
    // Each body is checked for a field it really has, so an empty or
    // mislocated slice fails loudly instead of passing vacuously.
    const supplier = modelBody(schema, 'Supplier');
    expect(supplier).toContain('contactPhone');
    expect(supplier).not.toMatch(/embedding/);

    const sourcedItem = modelBody(schema, 'SourcedItem');
    expect(sourcedItem).toContain('priceAmount');
    expect(sourcedItem).not.toMatch(/embedding/);

    const sourcedItemImage = modelBody(schema, 'SourcedItemImage');
    expect(sourcedItemImage).toContain('mediaKey');
    expect(sourcedItemImage).not.toMatch(/embedding/);
  });
});
