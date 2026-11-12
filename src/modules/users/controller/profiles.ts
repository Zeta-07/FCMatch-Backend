import type { Request, Response } from 'express';
import Busboy from 'busboy';
import { setTimeout as delay } from 'node:timers/promises';
import type { ProfilesService } from '../service/profiles.js';
import { AVATAR_MAX_BYTES } from '../service/avatar-image.js';
import { parseDto, verificationSchema } from '../dto/registration.js';
import {
  profilePatch,
  profileSearch,
  publicId,
  emailChange,
} from '../dto/profiles.js';
import { emptySchema } from '../dto/sessions.js';
import { unauthenticated } from '../service/access-token.js';
import { createBrowserCsrf } from '../../../shared/middleware/browser-csrf.js';
import { ApiError } from '../../../shared/errors/api-error.js';

let uploads = 0;

function access(req: Request) {
  const value = req.get('Authorization') ?? '';
  if (!/^Bearer [A-Za-z0-9_.-]{1,4096}$/.test(value)) throw unauthenticated();
  return value.slice(7);
}
export function readAvatar(
  req: Request,
): Promise<{ bytes: Buffer; mime: string }> {
  if (!req.is('multipart/form-data'))
    throw new ApiError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'Envía una imagen mediante multipart/form-data.',
    );
  return new Promise((resolve, reject) => {
    let parser: ReturnType<typeof Busboy>;
    try {
      parser = Busboy({
        headers: req.headers,
        limits: {
          files: 1,
          fields: 0,
          parts: 2,
          fileSize: AVATAR_MAX_BYTES + 1,
          headerPairs: 20,
        },
      });
    } catch {
      reject(
        new ApiError(422, 'VALIDATION_ERROR', 'El formulario no es válido.'),
      );
      return;
    }
    let failure: ApiError | undefined;
    let bytes: Buffer | undefined;
    let mime = '';
    let total = 0;
    const invalid = () => {
      failure ??= new ApiError(
        422,
        'VALIDATION_ERROR',
        'Envía exactamente un archivo en el campo file.',
      );
    };
    const large = () => {
      failure = new ApiError(
        413,
        'PAYLOAD_TOO_LARGE',
        'La foto supera el tamaño permitido.',
      );
    };
    const count = (chunk: Buffer) => {
      total += chunk.length;
      if (total > AVATAR_MAX_BYTES + 16_384) {
        large();
        req.unpipe(parser);
        parser.destroy();
        reject(failure);
        req.resume();
      }
    };
    req.on('data', count);
    req.once('aborted', () => {
      parser.destroy();
      reject(new ApiError(400, 'BAD_REQUEST', 'Carga interrumpida.'));
    });
    parser.on('file', (name, file, info) => {
      if (name !== 'file') invalid();
      mime = info.mimeType;
      const chunks: Buffer[] = [];
      file.on('limit', large);
      file.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      file.on('end', () => {
        bytes = Buffer.concat(chunks);
      });
      file.on('error', invalid);
    });
    for (const event of ['filesLimit', 'fieldsLimit', 'partsLimit'] as const)
      parser.on(event, invalid);
    parser.once('error', () => {
      req.removeListener('data', count);
      reject(
        new ApiError(422, 'VALIDATION_ERROR', 'El formulario está dañado.'),
      );
    });
    parser.once('close', () => {
      req.removeListener('data', count);
      if (failure) reject(failure);
      else if (!bytes?.length)
        reject(new ApiError(422, 'VALIDATION_ERROR', 'Falta la imagen.'));
      else resolve({ bytes, mime });
    });
    req.pipe(parser);
  });
}
export function profilesController(
  service: ProfilesService,
  csrf: ReturnType<typeof createBrowserCsrf>,
) {
  const readContext = (req: Request) => ({
    ...csrf.context(req),
    csrfFamily: '',
  });
  return {
    async own(req: Request, res: Response) {
      parseDto(emptySchema, req.query);
      res.json(await service.own(access(req), readContext(req)));
    },
    async publicProfile(req: Request, res: Response) {
      parseDto(emptySchema, req.query);
      res.json(
        await service.publicProfile(parseDto(publicId, req.params['publicId'])),
      );
    },
    async patch(req: Request, res: Response) {
      res.json(
        await service.patch(
          access(req),
          csrf.verify(req),
          parseDto(profilePatch, req.body),
        ),
      );
    },
    async search(req: Request, res: Response) {
      const input = parseDto(profileSearch, req.query);
      res.json(
        await service.search(
          access(req),
          readContext(req),
          input.search,
          input.limit,
          input.cursor,
        ),
      );
    },
    async replace(req: Request, res: Response) {
      const proof = csrf.verify(req);
      const token = access(req);
      if (uploads >= 2)
        throw new ApiError(
          503,
          'SERVICE_UNAVAILABLE',
          'Hay demasiadas cargas simultáneas.',
        );
      uploads++;
      try {
        const file = await readAvatar(req);
        res.json(await service.replace(token, proof, file.bytes, file.mime));
      } finally {
        uploads--;
      }
    },
    async remove(req: Request, res: Response) {
      parseDto(emptySchema, req.body ?? {});
      await service.remove(access(req), csrf.verify(req));
      res.sendStatus(204);
    },
    async requestEmail(req: Request, res: Response) {
      const input = parseDto(emailChange, req.body);
      const start = performance.now();
      try {
        await service.requestEmail(
          access(req),
          csrf.verify(req),
          input.newEmail,
          input.currentPassword,
          req.ip ?? 'unknown',
        );
      } finally {
        await delay(Math.max(0, 6000 - (performance.now() - start)));
      }
      res.status(202).json({
        message:
          'Si la solicitud es válida, recibirás instrucciones. Si no llegan, podrás solicitar un nuevo envío.',
      });
    },
    async confirmEmail(req: Request, res: Response) {
      const input = parseDto(verificationSchema, req.body);
      res.json(
        await service.confirmEmail(access(req), csrf.verify(req), input.token),
      );
    },
  };
}
