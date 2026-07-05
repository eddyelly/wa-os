/**
 * Split source content into chunks of roughly 500 tokens with overlap.
 * Tokens are approximated at 4 characters each, so the target is ~2000
 * characters per chunk with ~200 characters of overlap, preferring
 * paragraph and sentence boundaries.
 */

const TARGET_CHARS = 2_000;
const OVERLAP_CHARS = 200;
const MIN_CHUNK_CHARS = 40;

function splitLongBlock(block: string): string[] {
  const sentences = block.match(/[^.!?]+[.!?]*\s*/g) ?? [block];
  const parts: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (current.length + sentence.length > TARGET_CHARS && current.length > 0) {
      parts.push(current.trim());
      current = current.slice(Math.max(0, current.length - OVERLAP_CHARS));
    }
    current += sentence;
    // A single sentence longer than the target gets hard-split.
    while (current.length > TARGET_CHARS * 1.5) {
      parts.push(current.slice(0, TARGET_CHARS).trim());
      current = current.slice(TARGET_CHARS - OVERLAP_CHARS);
    }
  }
  if (current.trim().length > 0) {
    parts.push(current.trim());
  }
  return parts;
}

export function chunkContent(content: string): string[] {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  if (normalized.length === 0) {
    return [];
  }
  const paragraphs = normalized.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    const block = paragraph.trim();
    if (block.length === 0) {
      continue;
    }
    if (block.length > TARGET_CHARS) {
      if (current.trim().length >= MIN_CHUNK_CHARS) {
        chunks.push(current.trim());
        current = '';
      }
      chunks.push(...splitLongBlock(block));
      continue;
    }
    if (current.length + block.length + 2 > TARGET_CHARS && current.trim().length > 0) {
      chunks.push(current.trim());
      current = current.slice(Math.max(0, current.length - OVERLAP_CHARS));
    }
    current = current.length > 0 ? `${current}\n\n${block}` : block;
  }
  if (current.trim().length >= MIN_CHUNK_CHARS || (chunks.length === 0 && current.trim().length > 0)) {
    chunks.push(current.trim());
  }
  return chunks;
}
