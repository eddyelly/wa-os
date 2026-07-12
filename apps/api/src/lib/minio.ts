import { buffer as streamToBuffer } from 'node:stream/consumers';
import { Client } from 'minio';
import { config } from './config.js';
import { logger } from './logger.js';

function parseEndpoint(endpoint: string): { host: string; port: number; useSSL: boolean } {
  const withScheme = endpoint.includes('://') ? endpoint : `http://${endpoint}`;
  const url = new URL(withScheme);
  const useSSL = url.protocol === 'https:';
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : useSSL ? 443 : 9000,
    useSSL,
  };
}

const { host, port, useSSL } = parseEndpoint(config.MINIO_ENDPOINT);

export const minioClient = new Client({
  endPoint: host,
  port,
  useSSL,
  accessKey: config.MINIO_ACCESS_KEY,
  secretKey: config.MINIO_SECRET_KEY,
});

export async function ensureBucket(): Promise<void> {
  try {
    const exists = await minioClient.bucketExists(config.MINIO_BUCKET);
    if (!exists) {
      await minioClient.makeBucket(config.MINIO_BUCKET);
    }
  } catch (error) {
    // Media uploads will fail later with a clear error; boot should not die
    // just because MinIO is briefly unavailable.
    logger.warn({ err: error }, 'could not verify minio bucket at boot');
  }
}

export async function putMediaObject(
  key: string,
  data: Buffer,
  mimeType: string,
): Promise<string> {
  await minioClient.putObject(config.MINIO_BUCKET, key, data, data.length, {
    'Content-Type': mimeType,
  });
  return key;
}

/** Short-lived download URL the dashboard can use directly. */
export function getMediaUrl(key: string): Promise<string> {
  return minioClient.presignedGetObject(config.MINIO_BUCKET, key, 60 * 60);
}

/**
 * Resolves a stored object's real content type via `statObject`, without
 * fetching its bytes (the outbound worker used to hardcode
 * `application/octet-stream` for every media send). Falls back to
 * `application/octet-stream` both when the metadata has no content-type and
 * when the stat call itself fails: a lookup hiccup must never break an
 * outbound send.
 */
export async function getMediaMimeType(key: string): Promise<string> {
  try {
    const stat = await minioClient.statObject(config.MINIO_BUCKET, key);
    const metaData = stat.metaData as Record<string, unknown>;
    const contentType = metaData['content-type'];
    return typeof contentType === 'string' ? contentType : 'application/octet-stream';
  } catch (error) {
    logger.warn({ err: error }, 'could not resolve media mime type, falling back to octet-stream');
    return 'application/octet-stream';
  }
}

/**
 * Fetches a stored media object's bytes and content type, for handing an
 * inbound image straight to the vision-capable model. Never logs the bytes
 * (CLAUDE.md section 6); only the object key ever appears in logs upstream.
 */
export async function getMediaObject(key: string): Promise<{ data: Buffer; mimeType: string }> {
  const [stream, stat] = await Promise.all([
    minioClient.getObject(config.MINIO_BUCKET, key),
    minioClient.statObject(config.MINIO_BUCKET, key),
  ]);
  const data = await streamToBuffer(stream);
  const metaData = stat.metaData as Record<string, unknown>;
  const contentType = metaData['content-type'];
  return {
    data,
    mimeType: typeof contentType === 'string' ? contentType : 'application/octet-stream',
  };
}
