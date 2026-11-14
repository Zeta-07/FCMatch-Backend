import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from '../config/env.js';

export type AvatarStorage = {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
  sign(key: string): Promise<{ url: string; expiresAt: string }>;
};
const validateKey = (key: string) => {
  if (!/^avatars\/(?:[a-f0-9]{32}|[a-f0-9-]{36})\.(jpg|png|webp)$/.test(key))
    throw new Error('Clave de avatar no válida.');
};
export function createAvatarStorage(config: Config) {
  if (config.STORAGE_PROVIDER === 'disabled') return null;
  const local = config.STORAGE_PROVIDER === 's3-local';
  const bucket = local ? config.S3_BUCKET : config.R2_BUCKET;
  const client = new S3Client({
    endpoint: local
      ? config.S3_ENDPOINT
      : `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    region: local ? config.S3_REGION : 'auto',
    forcePathStyle: local,
    credentials: {
      accessKeyId: local ? config.S3_ACCESS_KEY_ID : config.R2_ACCESS_KEY_ID,
      secretAccessKey: local
        ? config.S3_SECRET_ACCESS_KEY
        : config.R2_SECRET_ACCESS_KEY,
    },
    maxAttempts: 1,
    requestHandler: {
      connectionTimeout: 2000,
      requestTimeout: 5000,
      throwOnRequestTimeout: true,
    },
  });
  return {
    async verify() {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    },
    async put(key: string, body: Buffer, contentType: string) {
      validateKey(key);
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: 'no-store',
          IfNoneMatch: '*',
        }),
      );
    },
    async remove(key: string) {
      validateKey(key);
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    async sign(key: string) {
      validateKey(key);
      const now = new Date();
      return {
        url: await getSignedUrl(
          client,
          new GetObjectCommand({
            Bucket: bucket,
            Key: key,
            ResponseCacheControl: 'no-store',
          }),
          { expiresIn: 300, signingDate: now },
        ),
        expiresAt: new Date(now.getTime() + 300_000).toISOString(),
      };
    },
    close() {
      client.destroy();
    },
  } satisfies AvatarStorage & { verify(): Promise<void>; close(): void };
}
