import type { Request, Response } from 'express';
import { setTimeout as delay } from 'node:timers/promises';
import type { SessionsService } from '../service/sessions.js';
import { unauthenticated } from '../service/access-token.js';
import {
  createBrowserCsrf,
  readBrowserCookie,
} from '../../../shared/middleware/browser-csrf.js';
import type { IdentityConfig } from '../../../shared/config/identity.js';
import { parseDto, resendSchema } from '../dto/registration.js';
import {
  loginSchema,
  emptySchema,
  resetSchema,
  changePasswordSchema,
} from '../dto/sessions.js';
import { ApiError } from '../../../shared/errors/api-error.js';

export function sessionsController(
  service: SessionsService,
  config: IdentityConfig,
  csrf: ReturnType<typeof createBrowserCsrf>,
) {
  const attributes = {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'strict' as const,
    path: '/api/v1/auth',
  };
  const refresh = (req: Request) =>
    readBrowserCookie(req, csrf.context(req).refreshName);
  const access = (req: Request) => {
    const value = req.get('Authorization') ?? '';
    if (!/^Bearer [A-Za-z0-9_.-]{1,4096}$/.test(value)) throw unauthenticated();
    return value.slice(7);
  };
  function clear(req: Request, res: Response) {
    const context = csrf.context(req);
    res.clearCookie(context.refreshName, attributes);
    res.clearCookie(context.name, attributes);
  }
  function reply(
    req: Request,
    res: Response,
    grant: Awaited<ReturnType<SessionsService['login']>>,
    renew = false,
  ) {
    const context = csrf.context(req);
    res.cookie(context.refreshName, grant.refreshToken, {
      ...attributes,
      expires: new Date(grant.sessionExpiresAt),
    });
    const proof = csrf.issue(req, res, grant.family, renew);
    res.json({
      accessToken: grant.accessToken,
      tokenType: grant.tokenType,
      expiresIn: grant.expiresIn,
      sessionExpiresAt: grant.sessionExpiresAt,
      ...proof,
    });
  }
  return {
    async bootstrap(req: Request, res: Response) {
      const context = csrf.context(req, true);
      const binding = await service.binding(
        readBrowserCookie(req, context.refreshName),
        context,
      );
      res.json(csrf.issue(req, res, binding));
    },
    async login(req: Request, res: Response) {
      const input = parseDto(loginSchema, req.body);
      const context = csrf.verify(req);
      const raw = refresh(req);
      if (raw) {
        const binding = await service.binding(raw, context);
        if (binding && binding !== context.csrfFamily)
          throw new ApiError(
            403,
            'CSRF_INVALID',
            'La protección de la solicitud no es válida.',
          );
      }
      const started = performance.now();
      try {
        const agent =
          [...(req.get('User-Agent') ?? 'Navegador')]
            .filter((c) => c.codePointAt(0)! >= 32)
            .slice(0, 200)
            .join('')
            .trim() || 'Navegador';
        const grant = await service.login(
          input.email,
          input.password,
          req.ip ?? 'unknown',
          context,
          agent,
        );
        await delay(Math.max(0, 500 - (performance.now() - started)));
        reply(req, res, grant, true);
      } catch (error) {
        await delay(Math.max(0, 500 - (performance.now() - started)));
        throw error;
      }
    },
    async refresh(req: Request, res: Response) {
      parseDto(emptySchema, req.body ?? {});
      reply(req, res, await service.refresh(refresh(req), csrf.verify(req)));
    },
    async logout(req: Request, res: Response) {
      parseDto(emptySchema, req.body ?? {});
      await service.logout(refresh(req), csrf.verify(req));
      clear(req, res);
      res.sendStatus(204);
    },
    async logoutAll(req: Request, res: Response) {
      parseDto(emptySchema, req.body ?? {});
      await service.logoutAll(access(req), csrf.verify(req));
      clear(req, res);
      res.sendStatus(204);
    },
    async forgot(req: Request, res: Response) {
      const input = parseDto(resendSchema, req.body);
      const start = performance.now();
      try {
        await service.forgot(input.email, req.ip ?? 'unknown');
      } finally {
        await delay(Math.max(0, 6000 - (performance.now() - start)));
      }
      res.status(202).json({
        message:
          'Si la solicitud es válida, recibirás instrucciones. Si no llegan, podrás solicitar un nuevo envío.',
      });
    },
    async reset(req: Request, res: Response) {
      const input = parseDto(resetSchema, req.body);
      await service.reset(input.token, input.newPassword);
      clear(req, res);
      res.sendStatus(204);
    },
    async change(req: Request, res: Response) {
      const input = parseDto(changePasswordSchema, req.body);
      await service.change(
        access(req),
        input.currentPassword,
        input.newPassword,
        csrf.verify(req),
      );
      clear(req, res);
      res.sendStatus(204);
    },
  };
}
