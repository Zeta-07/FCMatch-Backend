/* global process, fetch, AbortSignal, Buffer, console */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const windows = process.platform === 'win32';
if (!windows && process.platform !== 'linux')
  throw new Error('Configura SEAWEEDFS_BINARY para tu plataforma.');
const file = windows ? 'windows_amd64.zip' : 'linux_amd64.tar.gz';
const hash = windows
  ? 'd458d60e6a4120a64244b0ad7bc02cbc0e2fca71a7f775a88edc01da3b435cd7'
  : 'd1a7dec9f48d8b33895a0ea8951971defc2dc5312906dcc76fa5a5f74a6ee90d';
const directory = resolve('.local/storage/bin');
await mkdir(directory, { recursive: true });
const response = await fetch(
  `https://github.com/seaweedfs/seaweedfs/releases/download/4.53/${file}`,
  { signal: AbortSignal.timeout(120_000) },
);
if (!response.ok) throw new Error('Descarga SeaweedFS fallida.');
const bytes = Buffer.from(await response.arrayBuffer());
if (createHash('sha256').update(bytes).digest('hex') !== hash)
  throw new Error('Digest SeaweedFS incorrecto.');
const archive = resolve(directory, file);
await writeFile(archive, bytes);
if (windows)
  execFileSync('pwsh', [
    '-NoProfile',
    '-Command',
    `Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${directory.replaceAll("'", "''")}' -Force`,
  ]);
else execFileSync('tar', ['-xzf', archive, '-C', directory]);
console.log(
  'SeaweedFS 4.53 descargado y SHA-256 verificado en .local/storage/bin.',
);
