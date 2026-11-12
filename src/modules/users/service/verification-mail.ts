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
  purpose: 'verification' | 'reset' = 'verification',
) {
  return async ({ email, token }: VerificationDelivery) => {
    const controller = new AbortController();
    try {
      // Solo fragmento: no se envía el secreto al servidor web por GET ni por Referer.
      const link = `${webOrigin}/${purpose === 'reset' ? 'restablecer-contrasena' : 'verificar-correo'}#token=${token}`;
      await Promise.race([
        send({
          from,
          to: email,
          subject:
            purpose === 'reset'
              ? 'Restablece tu contraseña de FCMatch'
              : 'Verifica tu correo de FCMatch',
          text:
            purpose === 'reset'
              ? `Restablece tu contraseña explícitamente con este enlace (válido durante 30 minutos):\n${link}\nSi no solicitaste el cambio, ignora este mensaje.`
              : `Confirma tu correo explícitamente con este enlace (válido durante 24 horas):\n${link}\nSi no solicitaste el registro, ignora este mensaje.`,
        }),
        delay(5000, undefined, { signal: controller.signal }).then(() => {
          throw new Error('SMTP_TIMEOUT');
        }),
      ]);
    } catch {
      // No distinguir aceptación ambigua/rechazo; no borrar el hash ni reintentar.
      log(
        purpose === 'reset'
          ? 'RESET_DELIVERY_UNCONFIRMED'
          : 'VERIFICATION_DELIVERY_UNCONFIRMED',
        randomUUID(),
      );
    } finally {
      controller.abort();
    }
  };
}
