import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import type { Config } from '../config/env.js';

export function createStorage(config: Config) {
  if (!config.R2_ACCOUNT_ID) return null;
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.R2_ACCESS_KEY_ID,
      secretAccessKey: config.R2_SECRET_ACCESS_KEY,
    },
  });
  return {
    client,
    verify: () =>
      client.send(new HeadBucketCommand({ Bucket: config.R2_BUCKET })),
  };
}
