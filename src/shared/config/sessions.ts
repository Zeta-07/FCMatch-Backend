import { z } from 'zod';
import type { IdentityConfig } from './identity.js';

export function loadSessionSecret(
  identity: IdentityConfig,
  source: NodeJS.ProcessEnv = process.env,
) {
  const value = z
    .string()
    .regex(/^(?:[a-f0-9]{2}){32,64}$/)
    .safeParse(source['IDENTITY_JWT_SECRET']);
  if (
    !value.success ||
    value.data === identity.csrfSecret ||
    value.data === identity.abuseSecret
  )
    throw new Error('Configuración JWT incompleta o inválida.');
  return value.data;
}
