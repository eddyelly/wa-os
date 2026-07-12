import { describe, expect, it } from 'vitest';
import { pickReplyMedia } from './outbound-media.js';

describe('pickReplyMedia', () => {
  it('returns null when no product was seen', () => {
    expect(pickReplyMedia([], {})).toBeNull();
  });

  it('returns the mediaKey when exactly one product was seen and it has an image', () => {
    const result = pickReplyMedia(['p1'], { p1: 'products/p1-photo.jpg' });
    expect(result).toBe('products/p1-photo.jpg');
  });

  it('returns null when the single product seen has no image', () => {
    expect(pickReplyMedia(['p1'], { p1: undefined })).toBeNull();
    expect(pickReplyMedia(['p1'], {})).toBeNull();
  });

  it('returns null when two or more distinct products were seen, even if both have images', () => {
    const result = pickReplyMedia(['p1', 'p2'], {
      p1: 'products/p1-photo.jpg',
      p2: 'products/p2-photo.jpg',
    });
    expect(result).toBeNull();
  });

  it('treats repeated ids for the same product as a single distinct product', () => {
    const result = pickReplyMedia(['p1', 'p1'], { p1: 'products/p1-photo.jpg' });
    expect(result).toBe('products/p1-photo.jpg');
  });
});
