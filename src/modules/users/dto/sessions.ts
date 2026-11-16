import { z } from 'zod';
import { email, password, verificationSchema } from './registration.js';

const currentPassword = z
  .string()
  .refine(
    (value) =>
      [...value].length >= 1 &&
      [...value].length <= 128 &&
      !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
        value,
      ),
  );
export const loginSchema = z.strictObject({ email, password: currentPassword });
export const resetSchema = z.strictObject({
  token: verificationSchema.shape.token,
  newPassword: password,
});
export const changePasswordSchema = z.strictObject({
  currentPassword,
  newPassword: password,
});
export const emptySchema = z.strictObject({});
