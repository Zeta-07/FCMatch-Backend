import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import request from 'supertest';
import type { Pool } from 'pg';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/shared/config/env.js';
import type {
  LoginUserData,
  RegisterUserData,
  ResetUserPasswordData,
} from '../src/shared/api/types.gen.js';

interface Schema {
  $ref?: string;
  type?: string | string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean;
  items?: Schema;
  anyOf?: Schema[];
  required?: string[];
  minProperties?: number;
  maximum?: number;
  maxItems?: number;
  writeOnly?: boolean;
  'x-max-file-size-bytes'?: number;
}

interface Operation {
  operationId: string;
  'x-implementation-status': 'planned' | 'implemented';
  security?: Record<string, string[]>[];
  parameters?: { $ref?: string; name?: string; schema?: Schema }[];
  requestBody?: {
    $ref?: string;
    content?: Record<string, { schema: Schema }>;
  };
  responses: Record<string, { $ref?: string }>;
}

interface Contract {
  paths: Record<string, Record<string, Operation>>;
  security: Record<string, string[]>[];
  components: {
    schemas: Record<string, Schema>;
    securitySchemes: Record<
      string,
      { type: string; in?: string; name?: string }
    >;
    responses: Record<string, { headers?: Record<string, { $ref?: string }> }>;
  };
}

const root = fileURLToPath(new URL('../', import.meta.url));
let temporary: string | undefined;
let contract: Contract;

before(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'fcmatch-contract-'));
  const output = join(temporary, 'identity.json');
  // Reutiliza el parser instalado por Redocly, sin añadir otro parser como dependencia.
  const result = spawnSync(
    process.execPath,
    [
      join(root, 'node_modules/@redocly/cli/bin/cli.js'),
      'bundle',
      'docs/openapi.yaml',
      '--output',
      output,
      '--ext',
      'json',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  contract = JSON.parse(await readFile(output, 'utf8')) as Contract;
});

after(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

function schema(name: string): Schema {
  const value = contract.components.schemas[name];
  assert.ok(value, `Falta esquema ${name}`);
  return value;
}

function operation(path: string, method: string): Operation {
  const value = contract.paths[path]?.[method];
  assert.ok(value, `Falta ${method} ${path}`);
  return value;
}

function fields(value: Schema, seen = new Set<string>()): string[] {
  if (value.$ref) {
    if (seen.has(value.$ref)) return [];
    seen.add(value.$ref);
    return fields(schema(value.$ref.split('/').at(-1)!), seen);
  }
  return [
    ...Object.keys(value.properties ?? {}),
    ...Object.values(value.properties ?? {}).flatMap((item) =>
      fields(item, seen),
    ),
    ...(value.items ? fields(value.items, seen) : []),
    ...(value.anyOf ?? []).flatMap((item) => fields(item, seen)),
  ];
}

test('contrato identidad: limita las operaciones a RF-01 a RF-06 y health', () => {
  const ids = Object.values(contract.paths).flatMap((path) =>
    Object.values(path).map((item) => item.operationId),
  );
  assert.deepEqual(
    ids.sort(),
    [
      'getHealth',
      'getBrowserCsrf',
      'registerUser',
      'verifyUserEmail',
      'resendEmailVerification',
      'loginUser',
      'refreshBrowserSession',
      'logoutBrowserSession',
      'logoutAllUserSessions',
      'requestPasswordReset',
      'resetUserPassword',
      'changeUserPassword',
      'getMyProfile',
      'updateMyProfile',
      'requestMyEmailChange',
      'confirmMyEmailChange',
      'replaceMyAvatar',
      'deleteMyAvatar',
      'searchUsers',
      'getPublicProfile',
    ].sort(),
  );
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(
    operation('/health', 'get')['x-implementation-status'],
    'implemented',
  );
});

test('contrato identidad: separa perfiles públicos, datos propios y secretos', () => {
  const forbidden = [
    'email',
    'password',
    'passwordHash',
    'refreshToken',
    'avatarKey',
    'role',
    'sessionId',
  ];
  for (const name of ['PublicProfile', 'UsersPage']) {
    const actual = fields(schema(name));
    for (const field of forbidden)
      assert.ok(!actual.includes(field), `${name} expone ${field}`);
  }
  assert.ok(fields(schema('OwnProfile')).includes('email'));
  assert.equal(schema('PublicProfile').additionalProperties, false);
  assert.equal(schema('OwnProfile').additionalProperties, false);
  assert.equal(
    schema('PublicProfile').properties?.['statistics']?.type,
    'null',
  );
  assert.equal(schema('PublicProfile').properties?.['history']?.maxItems, 0);
  assert.equal(schema('BrowserSession').additionalProperties, false);
  assert.ok(!fields(schema('BrowserSession')).includes('refreshToken'));
  assert.deepEqual(schema('AcceptedRequest').required, ['message']);
  assert.deepEqual(Object.keys(schema('AcceptedRequest').properties ?? {}), [
    'message',
  ]);
});

test('contrato identidad: tipos de petición generados conservan campos writeOnly', () => {
  const registration: RegisterUserData['body'] = {
    email: 'pruebas@fcmatch.test',
    username: 'jugador_prueba',
    password: 'Frase sintética de prueba',
  };
  const login: LoginUserData['body'] = {
    email: registration.email,
    password: registration.password,
  };
  const reset: ResetUserPasswordData['body'] = {
    token: 'a'.repeat(43),
    newPassword: registration.password,
  };
  assert.equal(login.password, registration.password);
  assert.equal(reset.token.length, 43);
});

test('contrato identidad: CSRF en mutaciones y refresh solo mediante cookies separadas', () => {
  for (const path of Object.values(contract.paths)) {
    for (const [method, item] of Object.entries(path)) {
      if (method === 'get') continue;
      assert.ok(
        item.security?.length,
        `${item.operationId} sin seguridad explícita`,
      );
      for (const alternative of item.security!) {
        assert.ok('BrowserCsrf' in alternative, `${item.operationId} sin CSRF`);
      }
      assert.ok(
        item.parameters?.some((p) => p.$ref?.endsWith('/BrowserOrigin')),
      );
    }
  }
  const refresh = operation('/auth/refresh', 'post');
  assert.equal(refresh.requestBody, undefined);
  assert.deepEqual(refresh.security, [
    { WebRefreshCookie: [], BrowserCsrf: [] },
    { MobileBrowserRefreshCookie: [], BrowserCsrf: [] },
  ]);
  const schemes = contract.components.securitySchemes;
  assert.equal(schemes['WebRefreshCookie']?.in, 'cookie');
  assert.equal(schemes['MobileBrowserRefreshCookie']?.in, 'cookie');
  assert.notEqual(
    schemes['WebRefreshCookie']?.name,
    schemes['MobileBrowserRefreshCookie']?.name,
  );
  assert.deepEqual(operation('/users/{publicId}', 'get').security, []);
  assert.deepEqual(contract.security, [{ AccessToken: [] }]);
});

test('contrato identidad: rechaza asignación masiva y documenta límites de carga y paginación', () => {
  const update = schema('UpdateProfileRequest');
  assert.equal(update.additionalProperties, false);
  assert.equal(update.minProperties, 1);
  assert.deepEqual(Object.keys(update.properties ?? {}).sort(), [
    'leagueName',
    'username',
  ]);
  for (const name of ['NewPassword', 'CurrentPassword', 'ActionToken']) {
    assert.equal(schema(name).writeOnly, true);
  }
  const avatar = operation('/users/me/avatar', 'put');
  const upload = avatar.requestBody?.content?.['multipart/form-data']?.schema;
  assert.ok(upload);
  assert.equal(upload?.additionalProperties, false);
  assert.deepEqual(upload?.required, ['file']);
  assert.equal(
    upload.properties?.['file']?.['x-max-file-size-bytes'],
    5_242_880,
  );
  for (const code of ['401', '403', '413', '415', '422', '429', '503']) {
    assert.ok(avatar.responses[code]);
  }
  const search = operation('/users', 'get');
  assert.equal(
    search.parameters?.find((p) => p.name === 'limit')?.schema?.maximum,
    50,
  );
  for (const response of Object.values(contract.components.responses)) {
    assert.ok(
      response.headers?.['Cache-Control'],
      'Respuesta de identidad sin no-store',
    );
  }
});

test('contrato identidad: declarar operaciones planned no las implementa ni modifica health', async () => {
  const database = {
    query: async () => ({ rows: [{ '?column?': 1 }] }),
  } as unknown as Pick<Pool, 'query'>;
  const app = createApp(loadConfig(), database);
  await request(app).get('/api/v1/health').expect(200);
  for (const [path, methods] of Object.entries(contract.paths)) {
    for (const [method, item] of Object.entries(methods)) {
      if (item['x-implementation-status'] !== 'planned') continue;
      const url = `/api/v1${path.replace('{publicId}', '00000000-0000-4000-8000-000000000001')}`;
      const client = request(app);
      const response =
        method === 'get'
          ? await client.get(url)
          : method === 'post'
            ? await client.post(url)
            : method === 'patch'
              ? await client.patch(url)
              : method === 'put'
                ? await client.put(url)
                : await client.delete(url);
      assert.equal(response.status, 404, item.operationId);
      assert.equal(response.body.error.code, 'NOT_FOUND');
    }
  }
});
