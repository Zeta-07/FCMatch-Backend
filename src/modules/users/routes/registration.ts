import express from 'express';
import { rateLimit } from 'express-rate-limit';
import type { RegistrationService } from '../service/registration.js';
import type { IdentityConfig } from '../../../shared/config/identity.js';
import { createBrowserCsrf } from '../../../shared/middleware/browser-csrf.js';
import { registrationController } from '../controller/registration.js';
import { ApiError } from '../../../shared/errors/api-error.js';

export function registrationRoutes(
  service: RegistrationService,
  config: IdentityConfig,
) {
  const router = express.Router();
  const csrf = createBrowserCsrf(config);
  const controller = registrationController(service);
  const mutation = [
    (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      csrf.verify(req);
      if (!req.is('application/json'))
        throw new ApiError(
          415,
          'UNSUPPORTED_MEDIA_TYPE',
          'Se requiere contenido JSON.',
        );
      next();
    },
    express.json({ limit: '8kb' }),
  ];
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });
  router.get('/csrf', (req, res) => csrf.bootstrap(req, res));
  router.post('/register', ...mutation, controller.register);
  router.post('/resend-verification', ...mutation, controller.resend);
  router.post(
    '/verify-email',
    rateLimit({
      windowMs: 900_000,
      limit: 30,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_req, res) =>
        res
          .status(429)
          .set('Retry-After', '900')
          .json({
            error: {
              code: 'RATE_LIMITED',
              message: 'Demasiadas solicitudes. Inténtalo más tarde.',
              details: [],
            },
          }),
    }),
    ...mutation,
    controller.verify,
  );
  return router;
}
