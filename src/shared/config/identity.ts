import { z } from 'zod';
import type { Config } from './env.js';

const origin = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.origin === value &&
    (url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  );
});
const schema = z.object({
  IDENTITY_CSRF_SECRET: z.string().regex(/^[a-f0-9]{64,128}$/),
  IDENTITY_ABUSE_SECRET: z.string().regex(/^[a-f0-9]{64,128}$/),
  IDENTITY_WEB_ORIGIN: origin,
  IDENTITY_MOBILE_ORIGIN: origin,
  IDENTITY_API_ORIGIN: origin,
});

export function loadIdentityConfig(
  config: Config,
  source: NodeJS.ProcessEnv = process.env,
) {
  const parsed = schema.safeParse(source);
  if (!parsed.success)
    throw new Error('Configuración de identidad incompleta o inválida.');
  const value = parsed.data;
  const origins = [value.IDENTITY_WEB_ORIGIN, value.IDENTITY_MOBILE_ORIGIN];
  if (
    origins[0] === origins[1] ||
    value.IDENTITY_CSRF_SECRET === value.IDENTITY_ABUSE_SECRET ||
    !origins.every((item) => config.CORS_ORIGINS.includes(item)) ||
    (config.NODE_ENV === 'production' &&
      ([...origins, value.IDENTITY_API_ORIGIN].some(
        (item) => !item.startsWith('https:'),
      ) ||
        origins.some(
          (item) =>
            new URL(item).hostname !==
            new URL(value.IDENTITY_API_ORIGIN).hostname,
        )))
  ) {
    throw new Error(
      'Configuración de identidad incompatible con los orígenes permitidos.',
    );
  }
  return {
    csrfSecret: value.IDENTITY_CSRF_SECRET,
    abuseSecret: value.IDENTITY_ABUSE_SECRET,
    webOrigin: value.IDENTITY_WEB_ORIGIN,
    mobileOrigin: value.IDENTITY_MOBILE_ORIGIN,
    apiOrigin: value.IDENTITY_API_ORIGIN,
    secureCookies: value.IDENTITY_API_ORIGIN.startsWith('https:'),
  };
}
export type IdentityConfig = ReturnType<typeof loadIdentityConfig>;
