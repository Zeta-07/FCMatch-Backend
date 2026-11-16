import express from 'express';
import { rateLimit } from 'express-rate-limit';
import type { IdentityConfig } from '../../../shared/config/identity.js';
import { createBrowserCsrf } from '../../../shared/middleware/browser-csrf.js';
import { ApiError } from '../../../shared/errors/api-error.js';
import type { ProfilesService } from '../service/profiles.js';
import type { SessionsService } from '../service/sessions.js';
import { profilesController } from '../controller/profiles.js';

export function profilesRoutes(
  service: ProfilesService,
  sessions: SessionsService,
  config: IdentityConfig,
) {
  const router = express.Router();
  const csrf = createBrowserCsrf(config);
  const controller = profilesController(service, csrf);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });
  const mutation = async (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    const proof = csrf.verify(req);
    if (Object.keys(req.query).length)
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'No se admiten parámetros en esta solicitud.',
      );
    const authorization = req.get('Authorization') ?? '';
    if (!/^Bearer [A-Za-z0-9_.-]{1,4096}$/.test(authorization))
      throw new ApiError(
        401,
        'UNAUTHENTICATED',
        'No se pudo autenticar la solicitud.',
      );
    await sessions.authenticate(authorization.slice(7), proof);
    next();
  };
  const json = [
    (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      if (!req.is('application/json'))
        throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Envía JSON.');
      next();
    },
    express.json({ limit: '8kb' }),
  ];
  const limited = () =>
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
  router.get('/me', controller.own);
  router.patch('/me', mutation, ...json, controller.patch);
  router.put('/me/avatar', limited(), mutation, controller.replace);
  router.delete(
    '/me/avatar',
    mutation,
    express.json({ limit: '1kb' }),
    controller.remove,
  );
  router.post(
    '/me/email-change',
    limited(),
    mutation,
    ...json,
    controller.requestEmail,
  );
  router.post(
    '/me/email-change/confirm',
    limited(),
    mutation,
    ...json,
    controller.confirmEmail,
  );
  router.get('/', controller.search);
  router.get('/:publicId', controller.publicProfile);
  return router;
}
