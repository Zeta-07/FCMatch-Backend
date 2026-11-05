import nodemailer from 'nodemailer';
import type { Config } from '../config/env.js';

export function createMailTransport(config: Config) {
  return nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    ...(config.SMTP_USER
      ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } }
      : {}),
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 5000,
    ...(config.NODE_ENV === 'production' ? { requireTLS: true } : {}),
  });
}
