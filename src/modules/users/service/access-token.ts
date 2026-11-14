import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import { ApiError } from '../../../shared/errors/api-error.js';

import type { BrowserContext } from '../../../shared/types/browser-context.js';
export type { BrowserContext } from '../../../shared/types/browser-context.js';
export const unauthenticated = () =>
  new ApiError(401, 'UNAUTHENTICATED', 'No se pudo autenticar la solicitud.');
const claims = z.object({
  sub: z.uuid(),
  sid: z.uuid(),
  iat: z.number().int(),
  exp: z.number().int(),
});
export class AccessTokens {
  private readonly key: Uint8Array;
  constructor(
    secret: string,
    private readonly issuer: string,
    private readonly now = () => Date.now(),
  ) {
    this.key = Buffer.from(secret, 'hex');
  }
  async issue(
    userId: string,
    family: string,
    expires: Date,
    context: BrowserContext,
  ) {
    const issued = Math.floor(this.now() / 1000);
    const expiration = Math.min(
      issued + 900,
      Math.floor(expires.getTime() / 1000),
    );
    if (expiration <= issued) throw unauthenticated();
    return {
      accessToken: await new SignJWT({ sid: family, origin: context.origin })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setIssuer(this.issuer)
        .setAudience(`fcmatch:${context.client}`)
        .setSubject(userId)
        .setIssuedAt(issued)
        .setExpirationTime(expiration)
        .sign(this.key),
      expiresIn: expiration - issued,
    };
  }
  async verify(token: string, context: BrowserContext) {
    try {
      const verified = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
        typ: 'JWT',
        issuer: this.issuer,
        audience: `fcmatch:${context.client}`,
        currentDate: new Date(this.now()),
        requiredClaims: ['sub', 'sid', 'iat', 'exp'],
        maxTokenAge: '15m',
      });
      const parsed = claims.parse(verified.payload);
      if (
        parsed.exp <= parsed.iat ||
        parsed.exp - parsed.iat > 900 ||
        parsed.iat > Math.floor(this.now() / 1000) ||
        verified.payload['origin'] !== context.origin
      )
        throw unauthenticated();
      return { userId: parsed.sub, family: parsed.sid };
    } catch {
      throw unauthenticated();
    }
  }
}
