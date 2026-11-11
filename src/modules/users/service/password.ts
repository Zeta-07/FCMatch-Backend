import { hash, argon2id } from 'argon2';
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
