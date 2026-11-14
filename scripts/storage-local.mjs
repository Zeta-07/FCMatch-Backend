/* global process, console */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// Solo desarrollo/CI. Nunca reutilizar estas credenciales para producción.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const local = resolve(root, '.local/storage');
await mkdir(resolve(local, 'data'), { recursive: true });
const credentialsPath = resolve(local, 'credentials.json');
let credentials;
try {
  credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const identity = () => ({
    accessKey: randomBytes(16).toString('hex'),
    secretKey: randomBytes(32).toString('hex'),
  });
  credentials = {
    bootstrap: identity(),
    development: identity(),
    test: identity(),
  };
  await writeFile(credentialsPath, JSON.stringify(credentials), {
    mode: 0o600,
    flag: 'wx',
  });
}
const buckets = {
  development: 'fcmatch-dev-avatars',
  test: 'fcmatch-test-avatars',
};
// Claves internas, distintas de las credenciales S3. Protegen HTTP de volumen/filer.
if (!process.argv.includes('--init') && !process.argv.includes('--configure')) {
  await writeFile(
    resolve(local, 'security.toml'),
    [
      'jwt.signing',
      'jwt.signing.read',
      'jwt.filer_signing',
      'jwt.filer_signing.read',
    ]
      .map(
        (section) =>
          `[${section}]\nkey = "${randomBytes(32).toString('hex')}"\nexpires_after_seconds = 60\n`,
      )
      .join('\n'),
    { mode: 0o600 },
  );
  await writeFile(
    resolve(local, 'master.toml'),
    '[master.volume_growth]\ncopy_1 = 1\ncopy_2 = 1\ncopy_3 = 1\ncopy_other = 1\n',
    { mode: 0o600 },
  );
}
const identities = [
  {
    name: 'bootstrap',
    credentials: [credentials.bootstrap],
    actions: ['Admin', 'Read', 'Write', 'List'],
  },
  ...Object.entries(buckets).map(([name, bucket]) => ({
    name,
    credentials: [credentials[name]],
    actions: [`Read:${bucket}`, `Write:${bucket}`, `List:${bucket}`],
  })),
];
await writeFile(resolve(local, 's3.json'), JSON.stringify({ identities }), {
  mode: 0o600,
});
if (process.argv.includes('--configure')) {
  const envPath = resolve(root, '.env');
  let text = await readFile(envPath, 'utf8');
  const values = {
    STORAGE_PROVIDER: 's3-local',
    S3_ENDPOINT: 'http://127.0.0.1:8333',
    S3_REGION: 'us-east-1',
    S3_BUCKET: buckets.development,
    S3_ACCESS_KEY_ID: credentials.development.accessKey,
    S3_SECRET_ACCESS_KEY: credentials.development.secretKey,
  };
  for (const [name, value] of Object.entries(values)) {
    const pattern = new RegExp(`^${name}=.*$`, 'm');
    text = pattern.test(text)
      ? text.replace(pattern, `${name}=${value}`)
      : `${text.trimEnd()}\n${name}=${value}\n`;
  }
  await writeFile(envPath, text, { mode: 0o600 });
  console.log(
    'Almacenamiento local configurado en .env sin mostrar secretos; otras variables conservadas.',
  );
} else if (process.argv.includes('--init')) {
  const { S3Client, CreateBucketCommand, HeadBucketCommand } =
    await import('@aws-sdk/client-s3');
  const client = new S3Client({
    endpoint: 'http://127.0.0.1:8333',
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: credentials.bootstrap.accessKey,
      secretAccessKey: credentials.bootstrap.secretKey,
    },
    maxAttempts: 1,
  });
  try {
    for (const bucket of Object.values(buckets)) {
      const deadline = Date.now() + 60_000;
      for (;;) {
        try {
          try {
            await client.send(new HeadBucketCommand({ Bucket: bucket }));
          } catch (error) {
            if (error.$metadata?.httpStatusCode !== 404) throw error;
            await client.send(new CreateBucketCommand({ Bucket: bucket }));
          }
          break;
        } catch (error) {
          if (Date.now() >= deadline || error.$metadata?.httpStatusCode === 403)
            throw new Error('No se pudo preparar bucket local.', {
              cause: error,
            });
          await delay(1000);
        }
      }
    }
    console.log(
      'Buckets locales preparados; credenciales solo en .local/storage/credentials.json (ignorado).',
    );
  } finally {
    client.destroy();
  }
} else {
  const executable =
    process.env.SEAWEEDFS_BINARY ??
    resolve(local, 'bin', process.platform === 'win32' ? 'weed.exe' : 'weed');
  const child = spawn(
    executable,
    [
      'server',
      '-ip=127.0.0.1',
      '-ip.bind=127.0.0.1',
      '-s3.ip.bind=127.0.0.1',
      `-dir=${resolve(local, 'data')}`,
      '-master.telemetry=false',
      '-master.volumeSizeLimitMB=32',
      '-volume.max=16',
      '-volume.port=8088',
      '-volume.fileSizeLimitMB=6',
      '-disableHttp=false',
      '-filer=true',
      '-filer.disableHttp=true',
      '-filer.disableDirListing=true',
      '-filer.exposeDirectoryData=false',
      '-s3=true',
      `-s3.config=${resolve(local, 's3.json')}`,
      '-s3.iam=false',
      '-s3.autoCreateBucket=false',
      '-s3.port.iceberg=0',
      '-s3.port.lance=0',
      '-s3.allowedOrigins=http://localhost:4200,http://localhost:8100',
      '-s3.concurrentFileUploadLimit=2',
      '-s3.concurrentUploadLimitMB=12',
      '-s3.cacheCapacityMB=0',
      '-s3.readerCacheSizeMB=16',
      '-webdav=false',
      '-sftp=false',
      '-iam=false',
      '-metricsPort=0',
    ],
    { cwd: local, stdio: 'inherit' },
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => child.kill(signal));
  child.on('error', () => {
    console.error('No se pudo iniciar SeaweedFS; verifica SEAWEEDFS_BINARY.');
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 0;
  });
}
