import sharp from 'sharp';
import { ApiError } from '../../../shared/errors/api-error.js';

export const AVATAR_MAX_BYTES = 5_242_880;
let active = 0;
export async function validateAvatar(bytes: Buffer, mime: string) {
  if (!bytes.length || bytes.length > AVATAR_MAX_BYTES)
    throw new ApiError(
      413,
      'PAYLOAD_TOO_LARGE',
      'La foto debe pesar como máximo 5 MiB.',
    );
  const format = bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
    ? 'jpeg'
    : bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'png'
      : bytes.subarray(0, 4).toString() === 'RIFF' &&
          bytes.subarray(8, 12).toString() === 'WEBP'
        ? 'webp'
        : '';
  if (!format || mime !== `image/${format}`)
    throw new ApiError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'Usa una imagen JPG, PNG o WebP válida.',
    );
  if (active >= 2)
    throw new ApiError(
      503,
      'SERVICE_UNAVAILABLE',
      'Procesamiento de imágenes ocupado.',
    );
  active++;
  try {
    const image = sharp(bytes, {
      limitInputPixels: 16_777_216,
      failOn: 'warning',
      animated: false,
    });
    const metadata = await image.metadata();
    if (
      metadata.format !== format ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > 8192 ||
      metadata.height > 8192 ||
      (metadata.pages ?? 1) !== 1
    )
      throw new Error('Formato/dimensiones no admitidos.');
    // Recodifica: decodificación real y eliminación de EXIF/XMP/GPS/contenido añadido.
    const body = await image.rotate().toFormat(format).toBuffer();
    if (body.length > AVATAR_MAX_BYTES)
      throw new ApiError(
        413,
        'PAYLOAD_TOO_LARGE',
        'La foto procesada supera 5 MiB.',
      );
    return {
      body,
      contentType: `image/${format}`,
      extension: format === 'jpeg' ? 'jpg' : format,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'La imagen está dañada o sus dimensiones no son válidas.',
    );
  } finally {
    active--;
  }
}
