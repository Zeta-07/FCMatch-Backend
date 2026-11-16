import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { loadConfig } from '../src/shared/config/env.js';
import {
  validateAvatar,
  AVATAR_MAX_BYTES,
} from '../src/modules/users/service/avatar-image.js';
import { createAvatarStorage } from '../src/shared/storage/avatars.js';
import { parseDto } from '../src/modules/users/dto/registration.js';
import {
  profilePatch,
  profileSearch,
  emailChange,
} from '../src/modules/users/dto/profiles.js';

test('almacenamiento: no admite S3 local fuera de loopback o en producción', () => {
  const source = {
    ...process.env,
    STORAGE_PROVIDER: 's3-local',
    S3_ACCESS_KEY_ID: 'synthetic',
    S3_SECRET_ACCESS_KEY: 'synthetic',
    S3_BUCKET: 'fcmatch-test-avatars',
  };
  for (const S3_ENDPOINT of [
    'http://example.com',
    'http://127.0.0.1.evil.test',
    'http://user:pass@127.0.0.1:8333',
    'http://127.0.0.1:8333/?x=1',
  ])
    assert.throws(() => loadConfig({ ...source, S3_ENDPOINT }), /S3_ENDPOINT/);
  assert.throws(
    () =>
      loadConfig({
        ...source,
        S3_ENDPOINT: 'http://127.0.0.1:8333',
        NODE_ENV: 'production',
      }),
    /S3_ENDPOINT/,
  );
  assert.equal(
    createAvatarStorage(
      loadConfig({ ...process.env, STORAGE_PROVIDER: 'disabled' }),
    ),
    null,
  );
});
test('imágenes: decodifica JPG/PNG/WebP reales sin confiar en extensión o MIME', async () => {
  for (const format of ['jpeg', 'png', 'webp'] as const) {
    const input = await sharp({
      create: {
        width: 16,
        height: 16,
        channels: 3,
        background: { r: 1, g: 2, b: 3 },
      },
    })
      .toFormat(format)
      .withMetadata()
      .toBuffer();
    const result = await validateAvatar(input, `image/${format}`);
    const metadata = await sharp(result.body).metadata();
    assert.equal(metadata.format, format);
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.icc, undefined);
    await assert.rejects(validateAvatar(input, 'image/svg+xml'), {
      status: 415,
    });
  }
  await assert.rejects(validateAvatar(Buffer.from('<svg/>'), 'image/png'), {
    status: 415,
  });
  await assert.rejects(
    validateAvatar(Buffer.alloc(AVATAR_MAX_BYTES + 1), 'image/png'),
    { status: 413 },
  );
  await assert.rejects(
    validateAvatar(Buffer.from([255, 216, 255, 0]), 'image/jpeg'),
    { status: 415 },
  );
  const oversized = await sharp({
    create: {
      width: 8193,
      height: 1,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .png()
    .toBuffer();
  await assert.rejects(validateAvatar(oversized, 'image/png'), { status: 415 });
});

test('perfil DTO: rechaza asignación masiva, Unicode inválido y paginación fuera de límites', () => {
  for (const input of [
    {},
    { publicId: 'arbitrario' },
    { role: 'admin' },
    { avatarKey: 'avatars/x.png' },
    { leagueName: '<script>' },
    { leagueName: '\ud800' },
    { username: 'ábc' },
  ])
    assert.throws(() => parseDto(profilePatch, input), { status: 422 });
  assert.deepEqual(parseDto(profilePatch, { leagueName: ' Liga ' }), {
    leagueName: 'Liga',
  });
  assert.equal(
    parseDto(profilePatch, { leagueName: '🏆'.repeat(100) }).leagueName?.length,
    200,
  );
  assert.throws(
    () => parseDto(profilePatch, { leagueName: '🏆'.repeat(101) }),
    { status: 422 },
  );
  assert.throws(() => parseDto(profileSearch, { search: 'ab', limit: 0 }), {
    status: 422,
  });
  assert.throws(() => parseDto(profileSearch, { search: 'ab', limit: '2.5' }), {
    status: 422,
  });
  assert.throws(
    () =>
      parseDto(emailChange, {
        newEmail: 'x@fcmatch.test',
        currentPassword: 'a',
        userId: 'otro',
      }),
    { status: 422 },
  );
});
