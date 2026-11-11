import { z } from 'zod';
import { ApiError } from '../../../shared/errors/api-error.js';

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
const password = z.string().refine((value) => {
  const length = [...value].length;
  return (
    length >= 12 &&
    length <= 128 &&
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      value,
    )
  );
});
export const registrationSchema = z.strictObject({
  email,
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[A-Za-z0-9_]+$/),
  password,
});
export const resendSchema = z.strictObject({ email });
export const verificationSchema = z.strictObject({
  token: z
    .string()
    .min(43)
    .max(256)
    .regex(/^[A-Za-z0-9_-]+$/),
});
export function parseDto<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Revisa los datos de la solicitud.',
    );
  return result.data;
}
export type Registration = z.infer<typeof registrationSchema>;
