import type { Request, Response } from 'express';
import { setTimeout as delay } from 'node:timers/promises';
import {
  parseDto,
  registrationSchema,
  resendSchema,
  verificationSchema,
} from '../dto/registration.js';
import type { RegistrationService } from '../service/registration.js';

const accepted = {
  message:
    'Si la solicitud es válida, recibirás instrucciones. Si no llegan, podrás solicitar un nuevo envío.',
};
export function registrationController(service: RegistrationService) {
  async function mailRequest(res: Response, action: () => Promise<void>) {
    const started = performance.now();
    try {
      await action();
    } finally {
      await delay(Math.max(0, 6000 - (performance.now() - started)));
    }
    res.status(202).json(accepted);
  }
  return {
    async register(req: Request, res: Response) {
      const input = parseDto(registrationSchema, req.body);
      await mailRequest(res, () =>
        service.register(input, req.ip ?? 'unknown'),
      );
    },
    async resend(req: Request, res: Response) {
      const input = parseDto(resendSchema, req.body);
      await mailRequest(res, () =>
        service.resend(input.email, req.ip ?? 'unknown'),
      );
    },
    async verify(req: Request, res: Response) {
      const input = parseDto(verificationSchema, req.body);
      await service.verify(input.token);
      res.sendStatus(204);
    },
  };
}
