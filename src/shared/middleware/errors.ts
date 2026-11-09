import type { ErrorRequestHandler } from 'express';
import { ApiError } from '../errors/api-error.js';

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _req,
  res,
  _next,
) => {
  if (error instanceof ApiError) {
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
