import type { ErrorRequestHandler } from 'express';
import { ApiError } from '../errors/api-error.js';

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _req,
  res,
  _next,
) => {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      const detail = error.details[0] as { retryAfter?: number } | undefined;
      res.set('Retry-After', String(detail?.retryAfter ?? 900));
    }
    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
    return;
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    error.status === 413
  ) {
    res.status(413).json({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'La solicitud supera el tamaño permitido.',
        details: [],
      },
    });
    return;
  }
  if (
    error instanceof SyntaxError &&
    'status' in error &&
    error.status === 400
  ) {
    res.status(400).json({
      error: {
        code: 'INVALID_JSON',
        message: 'El cuerpo JSON no es válido.',
        details: [],
      },
    });
    return;
  }
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Ocurrió un error interno.',
      details: [],
    },
  });
};
