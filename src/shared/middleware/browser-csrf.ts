import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { IdentityConfig } from '../config/identity.js';
import { ApiError } from '../errors/api-error.js';

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
    };
  }
  function read(req: Request, name: string) {
    const matches = (req.get('Cookie') ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${name}=`));
    return matches.length === 1 ? matches[0]!.slice(name.length + 1) : '';
  }
  function valid(value: string, origin: string) {
    if (!/^\d{13}\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(value))
      return false;
    const [expires, nonce, signature] = value.split('.') as [
      string,
      string,
      string,
    ];
    return (
      Number(expires) > now() &&
      Number(expires) <= now() + 3_600_000 &&
      equal(signature, mac('context', origin, `${expires}.${nonce}`))
    );
  }
  return {
    bootstrap(req: Request, res: Response) {
      const { origin, name } = context(req, true);
      let cookie = read(req, name);
      if (!valid(cookie, origin)) {
        const payload = `${now() + 3_600_000}.${randomBytes(32).toString('base64url')}`;
        cookie = `${payload}.${mac('context', origin, payload)}`;
        res.cookie(name, cookie, {
          httpOnly: true,
          secure: config.secureCookies,
          sameSite: 'strict',
          path: '/api/v1/auth',
          maxAge: 3_600_000,
        });
      }
      res.json({
        csrfToken: mac('proof', origin, cookie),
        csrfExpiresAt: new Date(Number(cookie.split('.')[0])).toISOString(),
      });
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
    },
  };
}
