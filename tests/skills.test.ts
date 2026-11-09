import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const root = fileURLToPath(new URL('../', import.meta.url));

async function fixture(check: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'fcmatch-skills-'));
  try {
    await mkdir(join(directory, '.opencode'));
    await cp(
      join(root, '.opencode/skills'),
      join(directory, '.opencode/skills'),
      { recursive: true },
    );
    await cp(
      join(root, '.opencode/skills-lock.json'),
      join(directory, '.opencode/skills-lock.json'),
    );
    await mkdir(join(directory, 'scripts'));
    await mkdir(join(directory, 'docs'));
    await cp(
      join(root, 'scripts/manage-opencode-skills.mjs'),
      join(directory, 'scripts/manage-opencode-skills.mjs'),
    );
    await cp(
      join(root, 'docs/skills-sources.json'),
      join(directory, 'docs/skills-sources.json'),
    );
    await check(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function verify(directory: string) {
  return spawnSync(
    process.execPath,
    [join(directory, 'scripts/manage-opencode-skills.mjs'), '--check'],
    {
      encoding: 'utf8',
    },
  );
}

test('catálogo de skills: originales y recursos completos son válidos', async () => {
  await fixture(async (directory) => {
    const result = verify(directory);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Catálogo HTTP/);
  });
});

test('catálogo de skills: detecta alteración de un original', async () => {
  await fixture(async (directory) => {
    const path = join(directory, '.opencode/skills/angular-developer/SKILL.md');
    await writeFile(
      path,
      (await readFile(path, 'utf8')) + '\nAlteración de prueba\n',
    );
    const result = verify(directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Integridad incorrecta/);
  });
});

test('catálogo de skills: rechaza archivos adicionales sin ejecutarlos', async () => {
  await fixture(async (directory) => {
    await writeFile(
      join(directory, '.opencode/skills/angular-developer/unreviewed.js'),
      'throw new Error("not executed");',
    );
    const result = verify(directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Archivos inesperados/);
  });
});

test('catálogo de skills: detecta un índice HTTP desincronizado', async () => {
  await fixture(async (directory) => {
    await writeFile(
      join(directory, '.opencode/skills/index.json'),
      '{"skills":[]}',
    );
    const result = verify(directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Catálogo HTTP desincronizado/);
  });
});
