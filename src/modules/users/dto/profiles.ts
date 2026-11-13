import { z } from 'zod';
import { email } from './registration.js';
import { loginSchema } from './sessions.js';
export const profilePatch = z
  .strictObject({
    username: z
      .string()
      .regex(/^[A-Za-z0-9_]{3,30}$/)
      .optional(),
    leagueName: z
      .string()
      .trim()
      .refine(
        (v) =>
          [...v].length >= 1 &&
          [...v].length <= 100 &&
          !/[\p{Cc}\p{Cs}<>]/u.test(v),
      )
      .nullable()
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const publicNumber = z.string().regex(/^[1-9][0-9]{7}$/);
export const profileSearch = z
  .strictObject({
    search: z
      .string()
      .regex(/^[A-Za-z0-9_]{2,30}$/)
      .transform((v) => v.toLowerCase())
      .optional(),
    publicNumber: publicNumber.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().min(1).max(512).optional(),
  })
  .refine((v) => Boolean(v.search) !== Boolean(v.publicNumber))
  .refine((v) => !v.publicNumber || !v.cursor);
export const publicId = z.union([z.uuid(), publicNumber]);
export const emailChange = z.strictObject({
  newEmail: email,
  currentPassword: loginSchema.shape.password,
});
