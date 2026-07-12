import { describe, expect, it, vi } from 'vitest';
import { getMediaMimeType, minioClient } from './minio.js';

describe('getMediaMimeType', () => {
  it('resolves the content-type from the object stat metadata', async () => {
    vi.spyOn(minioClient, 'statObject').mockResolvedValue({
      size: 1234,
      etag: 'abc',
      lastModified: new Date('2026-01-01T00:00:00Z'),
      metaData: { 'content-type': 'image/webp' },
    });

    await expect(getMediaMimeType('products/p1.webp')).resolves.toBe('image/webp');
  });

  it('falls back to application/octet-stream when the metadata has no content-type', async () => {
    vi.spyOn(minioClient, 'statObject').mockResolvedValue({
      size: 1234,
      etag: 'abc',
      lastModified: new Date('2026-01-01T00:00:00Z'),
      metaData: {},
    });

    await expect(getMediaMimeType('products/p1.bin')).resolves.toBe('application/octet-stream');
  });

  it('falls back to application/octet-stream, never throws, when statObject rejects', async () => {
    vi.spyOn(minioClient, 'statObject').mockRejectedValue(new Error('object not found'));

    await expect(getMediaMimeType('products/missing.jpg')).resolves.toBe('application/octet-stream');
  });
});
