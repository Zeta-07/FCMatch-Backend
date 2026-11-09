import { readFile, writeFile, mkdir, access, readdir } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import process from 'node:process';
import console from 'node:console';
import { Buffer } from 'node:buffer';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sources = JSON.parse(
  await readFile(resolve(root, 'docs/skills-sources.json'), 'utf8'),
);
const [mode, stagingPath] = process.argv.slice(2);
const installed = resolve(root, '.opencode/skills');
const lockPath = resolve(root, '.opencode/skills-lock.json');
const catalogPath = resolve(installed, 'index.json');
const digest = (data, algorithm = 'sha256') =>
  createHash(algorithm).update(data).digest('hex');

function safePath(base, path) {
  const target = resolve(base, path);
  const rel = relative(base, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel))
    throw new Error(`Ruta no segura: ${path}`);
  return target;
}

async function download(url) {
  const response = await globalThis.fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function put(base, path, data) {
  const target = safePath(base, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, data, { flag: 'wx' });
}

if (mode === '--stage' && stagingPath) {
  const staging = resolve(stagingPath);
  await mkdir(staging, { recursive: true });
  const lock = { version: 1, sources: [] };
  for (const source of sources) {
    const tree = JSON.parse(
      await download(
        `https://api.github.com/repos/${source.repository}/git/trees/${source.commit}?recursive=1`,
      ),
    );
    if (tree.truncated || tree.sha !== source.commit)
      throw new Error('Árbol incompleto o revisión incorrecta');
    const entries = tree.tree.filter(
      (entry) =>
        entry.type === 'blob' && entry.path.startsWith(`${source.directory}/`),
    );
    const licenses = tree.tree.filter(
      (entry) =>
        entry.type === 'blob' &&
        /^(LICENSE[^/]*|NOTICE[^/]*)$/.test(entry.path),
    );
    const files = [];
    for (const entry of [...entries, ...licenses]) {
      if (
        entry.mode !== '100644' ||
        !/\.(md|json)$|^(LICENSE[^/]*|NOTICE[^/]*)$/.test(entry.path)
      ) {
        throw new Error(
          `Requiere revisión adicional (no se instalará): ${entry.path}`,
        );
      }
      const path = entry.path.startsWith(`${source.directory}/`)
        ? entry.path.slice(source.directory.length + 1)
        : entry.path;
      const data = await download(
        `https://raw.githubusercontent.com/${source.repository}/${source.commit}/${entry.path}`,
      );
      const blob = Buffer.concat([Buffer.from(`blob ${data.length}\0`), data]);
      if (digest(blob, 'sha1') !== entry.sha)
        throw new Error(`Blob distinto: ${entry.path}`);
      await put(staging, `${source.id}/${path}`, data);
      files.push({ path, sha256: digest(data), gitBlob: entry.sha });
    }
    if (!files.some((file) => file.path === 'SKILL.md'))
      throw new Error('Falta SKILL.md');
    lock.sources.push({ ...source, files });
    console.log(
      `Preparada para revisión: ${source.id}; ${files.length} archivos, sin scripts ni ejecutables`,
    );
  }
  await put(staging, 'skills-lock.json', JSON.stringify(lock, null, 2) + '\n');
} else if (mode === '--install-reviewed' && stagingPath) {
  const staging = resolve(stagingPath);
  const lock = JSON.parse(
    await readFile(resolve(staging, 'skills-lock.json'), 'utf8'),
  );
  lock.sources = lock.sources.filter((source) =>
    sources.some((selected) => selected.id === source.id),
  );
  if (
    JSON.stringify(
      lock.sources.map((source) => ({
        id: source.id,
        repository: source.repository,
        commit: source.commit,
        directory: source.directory,
      })),
    ) !== JSON.stringify(sources)
  )
    throw new Error('Fuentes distintas');
  for (const source of lock.sources) {
    try {
      await access(resolve(installed, source.id));
      throw new Error(`Ya existe: ${source.id}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    for (const file of source.files) {
      const data = await readFile(
        safePath(staging, `${source.id}/${file.path}`),
      );
      if (digest(data) !== file.sha256)
        throw new Error(`Archivo alterado: ${source.id}/${file.path}`);
      await put(installed, `${source.id}/${file.path}`, data);
    }
    console.log(`Instalada sin modificar: ${source.id}`);
  }
  await writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n', {
    flag: 'wx',
  });
} else if (mode === '--check' || mode === '--catalog') {
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  for (const source of lock.sources) {
    let count = 0;
    async function walk(path) {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        if (entry.isSymbolicLink())
          throw new Error('No se permiten enlaces simbólicos');
        if (entry.isDirectory()) await walk(resolve(path, entry.name));
        else count++;
      }
    }
    await walk(resolve(installed, source.id));
    if (count !== source.files.length)
      throw new Error(`Archivos inesperados: ${source.id}`);
    for (const file of source.files) {
      if (
        digest(
          await readFile(safePath(installed, `${source.id}/${file.path}`)),
        ) !== file.sha256
      )
        throw new Error(`Integridad incorrecta: ${source.id}/${file.path}`);
    }
    console.log(`Íntegra: ${source.id} (${count} archivos)`);
  }
  const catalog = {
    skills: lock.sources.map((source) => ({
      name: source.id,
      version: digest(JSON.stringify(source.files)),
      files: source.files.map((file) => file.path),
    })),
  };
  if (mode === '--catalog') {
    await writeFile(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
  } else if (
    JSON.stringify(JSON.parse(await readFile(catalogPath, 'utf8'))) !==
    JSON.stringify(catalog)
  ) {
    throw new Error('Catálogo HTTP desincronizado con skills-lock.json');
  }
  console.log(
    'Catálogo HTTP: seis skills y sus recursos completos verificados.',
  );
} else {
  throw new Error(
    'Uso: --stage <directorio-nuevo> | --install-reviewed <directorio-revisado> | --catalog | --check',
  );
}
