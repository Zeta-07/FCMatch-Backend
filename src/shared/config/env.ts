import { z } from 'zod';

const schema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    CORS_ORIGINS: z
      .string()
      .min(1)
      .transform((value) => value.split(',').map((origin) => origin.trim())),
    DATABASE_URL: z.url().refine((value) => /^postgres(ql)?:/.test(value)),
    TEST_DATABASE_URL: z.url().optional(),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    SMTP_USER: z.string().default(''),
    SMTP_PASSWORD: z.string().default(''),
    SMTP_FROM: z.string().min(1),
    R2_ACCOUNT_ID: z.string().default(''),
    R2_ACCESS_KEY_ID: z.string().default(''),
    R2_SECRET_ACCESS_KEY: z.string().default(''),
    R2_BUCKET: z.string().default(''),
    STORAGE_PROVIDER: z
      .enum(['disabled', 's3-local', 'r2'])
      .default('disabled'),
    S3_ENDPOINT: z.string().default(''),
    S3_REGION: z.string().default('us-east-1'),
    S3_ACCESS_KEY_ID: z.string().default(''),
    S3_SECRET_ACCESS_KEY: z.string().default(''),
    S3_BUCKET: z.string().default(''),
  })
  .superRefine((value, ctx) => {
    if (value.STORAGE_PROVIDER === 's3-local') {
      let allowed = false;
      try {
        const url = new URL(value.S3_ENDPOINT);
        allowed =
          url.protocol === 'http:' &&
          url.hostname === '127.0.0.1' &&
          !url.username &&
          !url.password &&
          url.pathname === '/' &&
          !url.search &&
          !url.hash;
      } catch {
        /* Invalid configuration is reported without values. */
      }
      if (
        value.NODE_ENV === 'production' ||
        !allowed ||
        !value.S3_ACCESS_KEY_ID ||
        !value.S3_SECRET_ACCESS_KEY ||
        !/^[a-z0-9][a-z0-9-]{2,62}$/.test(value.S3_BUCKET)
      )
        ctx.addIssue({
          code: 'custom',
          path: ['S3_ENDPOINT'],
          message:
            'S3 local requiere loopback y credenciales; prohibido en producción.',
        });
    }
    if (
      value.STORAGE_PROVIDER === 'r2' &&
      ![
        value.R2_ACCOUNT_ID,
        value.R2_ACCESS_KEY_ID,
        value.R2_SECRET_ACCESS_KEY,
        value.R2_BUCKET,
      ].every(Boolean)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['R2_BUCKET'],
        message: 'Completa R2.',
      });
    const r2 = [
      value.R2_ACCOUNT_ID,
      value.R2_ACCESS_KEY_ID,
      value.R2_SECRET_ACCESS_KEY,
      value.R2_BUCKET,
    ];
    if (r2.some(Boolean) && !r2.every(Boolean)) {
      ctx.addIssue({
        code: 'custom',
        path: ['R2_BUCKET'],
        message: 'Completa todas las variables de R2.',
      });
    }
    if (Boolean(value.SMTP_USER) !== Boolean(value.SMTP_PASSWORD)) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_USER'],
        message: 'Completa las credenciales SMTP.',
      });
    }
  });

export function loadConfig(source: NodeJS.ProcessEnv = process.env) {
  const result = schema.safeParse(source);
  if (!result.success) {
    // Solo nombres de campos: nunca imprimir valores de configuración ni credenciales.
    throw new Error(
      `Configuración inválida: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  }
  return result.data;
}

export type Config = ReturnType<typeof loadConfig>;
