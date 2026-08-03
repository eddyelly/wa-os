import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The sourcing module records what the owner PAYS for goods. That is the
 * most commercially sensitive data in the system, so it must never reach
 * the customer-facing AI. These tests pin the two structural guarantees.
 */
describe('sourcing data never reaches the AI', () => {
  it('registers no sourcing tool with the agent loop', () => {
    const shopTools = readFileSync('src/services/shop-tools.ts', 'utf8');
    expect(shopTools).not.toMatch(/supplier/i);
    expect(shopTools).not.toMatch(/sourcedItem/i);
  });

  it('gives neither sourcing model an embedding column', () => {
    const schema = readFileSync('prisma/schema.prisma', 'utf8');
    const sourcedItem = schema.slice(
      schema.indexOf('model SourcedItem '),
      schema.indexOf('model SourcedItemImage '),
    );
    expect(sourcedItem).not.toMatch(/embedding/);
    const supplier = schema.slice(
      schema.indexOf('model Supplier '),
      schema.indexOf('model SourcedItem '),
    );
    expect(supplier).not.toMatch(/embedding/);
  });
});
