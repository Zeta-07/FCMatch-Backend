import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  S3Client,
  GetObjectCommand,
  HeadBucketCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createAvatarStorage } from '../../src/shared/storage/avatars.js';
import { loadConfig } from '../../src/shared/config/env.js';

test('S3 real: escritura, firma, privacidad, caducidad, aislamiento y borrado', async () => {
  const credentials = JSON.parse(
    await readFile('.local/storage/credentials.json', 'utf8'),
  ) as { test: { accessKey: string; secretKey: string } };
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    STORAGE_PROVIDER: 's3-local',
    S3_ENDPOINT: 'http://127.0.0.1:8333',
    S3_BUCKET: 'fcmatch-test-avatars',
    S3_ACCESS_KEY_ID: credentials.test.accessKey,
    S3_SECRET_ACCESS_KEY: credentials.test.secretKey,
  });
  const storage = createAvatarStorage(config)!;
  const client = new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
    maxAttempts: 1,
  });
  const key = `avatars/${randomUUID()}.png`;
  const bytes = Buffer.from('synthetic storage transport fixture');
  try {
    await storage.verify();
    await storage.put(key, bytes, 'image/png');
    const signed = await storage.sign(key);
    assert.ok(Date.parse(signed.expiresAt) > Date.now());
    const response = await fetch(signed.url);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    const plain = new URL(signed.url);
    plain.search = '';
    assert.equal((await fetch(plain)).status, 403);
    const altered = new URL(signed.url);
    altered.searchParams.set('X-Amz-Signature', '0'.repeat(64));
    assert.equal((await fetch(altered)).status, 403);
    const expired = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }),
      { signingDate: new Date(Date.now() - 600_000), expiresIn: 1 },
    );
    assert.equal((await fetch(expired)).status, 403);
    await assert.rejects(
      client.send(new HeadBucketCommand({ Bucket: 'fcmatch-dev-avatars' })),
    );
    await assert.rejects(storage.remove('../not-an-avatar'));
    await storage.remove(key);
    assert.equal((await fetch(signed.url)).status, 404);
    await storage.remove(key);
    // No acceso directo a objetos por el filer HTTP.
    const filer = await fetch(
      `http://127.0.0.1:8888/buckets/${config.S3_BUCKET}/${key}`,
    ).catch(() => null);
    assert.ok(filer === null || filer.status >= 400);
  } finally {
    await client.send(
      new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: key }),
    );
    storage.close();
    client.destroy();
  }
});
