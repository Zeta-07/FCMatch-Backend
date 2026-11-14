import { hash, verify, argon2id } from 'argon2';
import { randomBytes } from 'node:crypto';
import { ApiError } from '../../../shared/errors/api-error.js';

export const argonOptions = {
  type: argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
} as const;
export function createPasswordHasher(
  maximum = 2,
  compute: (password: string) => Promise<string> = (password) =>
    hash(password, argonOptions),
) {
  let active = 0;
  return async (password: string) => {
    if (active >= maximum)
      throw new ApiError(
        503,
        'SERVICE_UNAVAILABLE',
        'Servicio temporalmente ocupado. Inténtalo más tarde.',
      );
    active++;
    try {
      return await compute(password);
    } finally {
      active--;
    }
  };
}

export async function createPasswordCrypto() {
  const dummy = await hash(randomBytes(32), argonOptions);
  let active = 0;
  async function run<T>(action: () => Promise<T>) {
    if (active >= 2)
      throw new ApiError(
        503,
        'SERVICE_UNAVAILABLE',
        'Servicio temporalmente ocupado. Inténtalo más tarde.',
      );
    active++;
    try {
      return await action();
    } finally {
      active--;
    }
  }
  return {
    hash: (password: string) => run(() => hash(password, argonOptions)),
    verify: (stored: string | undefined, password: string) =>
      run(() => verify(stored ?? dummy, password)),
  };
}
