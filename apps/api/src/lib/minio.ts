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
