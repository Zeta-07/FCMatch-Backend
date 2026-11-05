import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import type { Pool } from 'pg';
import type { Config } from './shared/config/env.js';
import { ApiError } from './shared/errors/api-error.js';
import { errorHandler } from './shared/middleware/errors.js';

// Solo infraestructura: los módulos de negocio se incorporarán en sus fases autorizadas.
export function createApp(config: Config, database: Pick<Pool, 'query'>) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || config.CORS_ORIGINS.includes(origin))
          callback(null, true);
        else
          callback(
            new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'Origen no permitido.'),
          );
      },
      credentials: true,
    }),
  );
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_req, res) =>
        res.status(429).json({
          error: {
            code: 'RATE_LIMITED',
            message: 'Demasiadas solicitudes. Inténtalo más tarde.',
            details: [],
          },
        }),
    }),
  );
  app.use(express.json({ limit: '64kb' }));
  app.get('/api/v1/health', async (_req, res) => {
    try {
      await database.query('SELECT 1');
      res.json({ status: 'ok', service: 'fcmatch-api', database: 'connected' });
    } catch {
      throw new ApiError(
        503,
        'DATABASE_UNAVAILABLE',
        'La base de datos no está disponible.',
      );
    }
  });
  app.use((_req, _res, next) =>
    next(new ApiError(404, 'NOT_FOUND', 'Recurso no encontrado.')),
  );
  app.use(errorHandler);
  return app;
}
