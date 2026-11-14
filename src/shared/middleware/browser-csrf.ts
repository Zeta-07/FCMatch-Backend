import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { IdentityConfig } from '../config/identity.js';
import { ApiError } from '../errors/api-error.js';
import type { BrowserContext } from '../types/browser-context.js';

export function readBrowserCookie(req: Request, name: string) {
  const matches = (req.get('Cookie') ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  return matches.length === 1 ? matches[0]!.slice(name.length + 1) : '';
}

const equal = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function createBrowserCsrf(
  config: IdentityConfig,
  now = () => Date.now(),
) {
  const mac = (purpose: string, origin: string, value: string) =>
    createHmac('sha256', config.csrfSecret)
      .update(`${purpose}\0${origin}\0${value}`)
      .digest('base64url');
  function context(req: Request, bootstrap: boolean) {
    let origin = req.get('Origin');
    if (!origin && bootstrap && req.get('Sec-Fetch-Site') === 'same-origin')
      origin = config.apiOrigin;
    if (origin !== config.webOrigin && origin !== config.mobileOrigin)
      throw new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'Origen no permitido.');
    return {
      origin,
      name:
        origin === config.webOrigin
          ? 'fcmatch_csrf_web'
          : 'fcmatch_csrf_mobile',
      client:
        origin === config.webOrigin
          ? ('web' as const)
          : ('mobile_browser' as const),
      refreshName:
        origin === config.webOrigin
          ? 'fcmatch_refresh_web'
          : 'fcmatch_refresh_mobile',
    };
  }
  function read(req: Request, name: string) {
    return readBrowserCookie(req, name);
  }
  function valid(value: string, origin: string) {
    if (
      !/^\d{13}\.[A-Za-z0-9_-]{43}\.(-|[a-f0-9-]{36})\.v2\.[A-Za-z0-9_-]{43}$/.test(
        value,
      )
    )
      return false;
    const [expires, nonce, binding, version, signature] = value.split('.') as [
      string,
      string,
      string,
      string,
      string,
    ];
    return (
      Number(expires) > now() &&
      Number(expires) <= now() + 3_600_000 &&
      equal(
        signature,
        mac('context', origin, `${expires}.${nonce}.${binding}.${version}`),
      )
    );
  }
  function issue(req: Request, res: Response, binding = '', renew = false) {
    const { origin, name } = context(req, true);
    let cookie = read(req, name);
    if (
      renew ||
      !valid(cookie, origin) ||
      cookie.split('.')[2] !== (binding || '-')
    ) {
      // v2 migra el antiguo Path /auth sin cambiar la raíz de sesión.
      res.clearCookie(name, {
        httpOnly: true,
        secure: config.secureCookies,
        sameSite: 'strict',
        path: '/api/v1/auth',
      });
      const payload = `${now() + 3_600_000}.${randomBytes(32).toString('base64url')}.${binding || '-'}.v2`;
      cookie = `${payload}.${mac('context', origin, payload)}`;
      res.cookie(name, cookie, {
        httpOnly: true,
        secure: config.secureCookies,
        sameSite: 'strict',
        path: '/api/v1',
        maxAge: 3_600_000,
      });
    }
    return {
      csrfToken: mac('proof', origin, cookie),
      csrfExpiresAt: new Date(Number(cookie.split('.')[0])).toISOString(),
    };
  }
  return {
    context: (req: Request, bootstrap = false) => context(req, bootstrap),
    issue,
    bootstrap(req: Request, res: Response) {
      res.json(issue(req, res));
    },
    verify(req: Request) {
      const { origin, name } = context(req, false);
      const cookie = read(req, name);
      const proof = req.get('X-CSRF-Token') ?? '';
      if (
        !valid(cookie, origin) ||
        !/^[A-Za-z0-9_-]{43}$/.test(proof) ||
        !equal(proof, mac('proof', origin, cookie))
      )
        throw new ApiError(
          403,
          'CSRF_INVALID',
          'La protección de la solicitud no es válida.',
        );
      return {
        origin,
        client: context(req, false).client,
        csrfFamily: cookie.split('.')[2] === '-' ? '' : cookie.split('.')[2]!,
      } satisfies BrowserContext;
    },
  };
}
