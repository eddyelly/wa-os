import { describe, expect, it } from 'vitest';
import { chunkContent } from './chunking.js';

describe('chunking', () => {
  it('keeps short content as a single chunk', () => {
    const chunks = chunkContent('Bei ya rasta ni TZS 25,000. Tunafungua saa tatu asubuhi.');
    expect(chunks).toHaveLength(1);
  });

  it('returns nothing for empty content', () => {
    expect(chunkContent('   \n\n  ')).toEqual([]);
  });

  it('splits long content into bounded chunks', () => {
    const paragraph = 'Huduma zetu ni pamoja na kusuka, kupaka rangi, na manicure. '.repeat(20);
    const content = Array.from({ length: 10 }, () => paragraph).join('\n\n');
    const chunks = chunkContent(content);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(3_100);
      expect(chunk.length).toBeGreaterThan(0);
    }
  });

  it('creates overlap between consecutive chunks of one long block', () => {
    const sentence = 'Neno moja baada ya lingine linaunda sentensi ndefu sana kabisa. ';
    const content = sentence.repeat(120);
    const chunks = chunkContent(content);
    expect(chunks.length).toBeGreaterThan(1);
    const first = chunks[0] ?? '';
    const second = chunks[1] ?? '';
    const tail = first.slice(-60);
    expect(second.includes(tail.slice(0, 30)) || second.startsWith(tail.trim().slice(0, 20))).toBe(
      true,
    );
  });

  it('preserves all substantive text across chunks', () => {
    const content = ['Bei ya kwanza.', 'Bei ya pili.', 'Bei ya tatu.'].join('\n\n');
    const chunks = chunkContent(content);
    const joined = chunks.join(' ');
    expect(joined).toContain('Bei ya kwanza.');
    expect(joined).toContain('Bei ya tatu.');
  });
});
