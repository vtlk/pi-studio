import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { safePath } from '../storage/files.ts';
import { validatePngBytes } from '../storage/png.ts';

export interface ImageReference {
  bytes: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  sha256: string;
}
const imageLimit = 32 * 1024 ** 2;
const totalLimit = 64 * 1024 ** 2;
function mimeType(bytes: Buffer): ImageReference['mimeType'] {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    validatePngBytes(bytes);
    return 'image/png';
  }
  if (bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return 'image/jpeg';
  if (
    bytes.length > 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  throw new Error(
    'Референсы Images API должны быть изображениями PNG, JPEG или WebP. SVG/GIF сначала преобразуйте в PNG.',
  );
}
/** Only files in the bound project. Exact bytes are held in memory for this one API call. */
export async function readImageReferences(root: string, value: unknown): Promise<ImageReference[]> {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > 16 ||
    value.some((path) => typeof path !== 'string' || !path || path.length > 2000) ||
    new Set(value).size !== value.length
  )
    throw new Error('Укажите до 16 разных путей референсов относительно папки проекта.');
  const result: ImageReference[] = [];
  let total = 0;
  for (const path of value as string[]) {
    const file = await open(
      await safePath(root, path),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const before = await file.stat();
      if (!before.isFile() || !before.size || before.size > imageLimit)
        throw new Error('Референс должен быть обычным изображением размером до 32 МБ.');
      total += before.size;
      if (total > totalLimit) throw new Error('Общий размер референсов Images API — до 64 МБ.');
      const bytes = Buffer.alloc(before.size);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      const after = await file.stat();
      if (
        offset !== before.size ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs
      )
        throw new Error(
          'Референс изменился во время чтения. Повторите запрос после сохранения файла.',
        );
      result.push({
        bytes,
        mimeType: mimeType(bytes),
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    } finally {
      await file.close();
    }
  }
  return result;
}
