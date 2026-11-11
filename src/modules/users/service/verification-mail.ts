import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { VerificationDelivery } from './registration.js';

export type MailSender = (mail: {
  from: string;
  to: string;
  subject: string;
  text: string;
}) => Promise<unknown>;
export function createVerificationDelivery(
  send: MailSender,
  from: string,
  webOrigin: string,
  log: (category: string, correlation: string) => void = (
    category,
    correlation,
  ) => console.warn(category, correlation),
) {
  return async ({ email, token }: VerificationDelivery) => {
    const controller = new AbortController();
    try {
      // Solo fragmento: no se envía el secreto al servidor web por GET ni por Referer.
      const link = `${webOrigin}/verificar-correo#token=${token}`;
      await Promise.race([
        send({
          from,
          to: email,
          subject: 'Verifica tu correo de FCMatch',
          text: `Confirma tu correo explícitamente con este enlace (válido durante 24 horas):\n${link}\nSi no solicitaste el registro, ignora este mensaje.`,
        }),
        delay(5000, undefined, { signal: controller.signal }).then(() => {
          throw new Error('SMTP_TIMEOUT');
        }),
      ]);
    } catch {
      // No distinguir aceptación ambigua/rechazo; no borrar el hash ni reintentar.
      log('VERIFICATION_DELIVERY_UNCONFIRMED', randomUUID());
    } finally {
      controller.abort();
    }
  };
}
