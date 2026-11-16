import express from 'express';
import { rateLimit } from 'express-rate-limit';
import type { RegistrationService } from '../service/registration.js';
import type { IdentityConfig } from '../../../shared/config/identity.js';
import {
  createBrowserCsrf,
  readBrowserCookie,
} from '../../../shared/middleware/browser-csrf.js';
import type { SessionsService } from '../service/sessions.js';
import { sessionsController } from '../controller/sessions.js';
import { registrationController } from '../controller/registration.js';
import { ApiError } from '../../../shared/errors/api-error.js';

export function registrationRoutes(
  service: RegistrationService,
  config: IdentityConfig,
  sessions?: SessionsService,
) {
  const router = express.Router();
  const csrf = createBrowserCsrf(config);
  const controller = registrationController(service);
  const guard =
    (allowEmpty: boolean) =>
    async (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      const context = csrf.verify(req);
      if (Object.keys(req.query).length)
        throw new ApiError(
          422,
          'VALIDATION_ERROR',
          'No se admiten parámetros en esta solicitud.',
        );
      if (sessions) {
        const raw = readBrowserCookie(req, csrf.context(req).refreshName);
        if (raw) {
          const binding = await sessions.binding(raw, context);
          if (binding && binding !== context.csrfFamily)
            throw new ApiError(
              403,
              'CSRF_INVALID',
              'La protección de la solicitud no es válida.',
            );
        }
      }
      if (
        !req.is('application/json') &&
        !(
          allowEmpty &&
          !req.get('Content-Type') &&
          !req.get('Transfer-Encoding') &&
          (!req.get('Content-Length') || req.get('Content-Length') === '0')
        )
      )
        throw new ApiError(
          415,
          'UNSUPPORTED_MEDIA_TYPE',
          'Se requiere contenido JSON.',
        );
      next();
    };
  const mutation = [guard(false), express.json({ limit: '8kb' })];
  const emptyMutation = [guard(true), express.json({ limit: '8kb' })];
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });
  if (sessions) {
    const auth = sessionsController(sessions, config, csrf);
    const limit = () =>
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
      });
    router.get('/csrf', auth.bootstrap);
    router.post('/login', ...mutation, auth.login);
    router.post('/refresh', ...emptyMutation, auth.refresh);
    router.post('/logout', ...emptyMutation, auth.logout);
    router.post('/logout-all', ...emptyMutation, auth.logoutAll);
    router.post('/forgot-password', ...mutation, auth.forgot);
    router.post('/reset-password', limit(), ...mutation, auth.reset);
    router.post('/change-password', limit(), ...mutation, auth.change);
  } else router.get('/csrf', (req, res) => csrf.bootstrap(req, res));
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
