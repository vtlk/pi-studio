import { t } from '../../shared/i18n/index.ts';
import { crc32, inflateSync } from 'node:zlib';

export function validatePngBytes(bytes: Buffer) {
  if (
    bytes.length < 57 ||
    bytes.length > 32 * 1024 ** 2 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.toString('ascii', 12, 16) !== 'IHDR'
  )
    throw new Error(t('error.png.invalidAssetPng'));
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  if (!width || !height || width > 16384 || height > 16384)
    throw new Error(t('error.png.pngDimensionsAreOutsideThe'));
  const compressed: Buffer[] = [];
  let offset = 8,
    ended = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset),
      end = offset + 12 + length;
    if (end > bytes.length) throw new Error(t('error.png.truncatedPng'));
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4))
      throw new Error(t('error.png.pngChecksumMismatch'));
    if (offset === 8 && (type !== 'IHDR' || length !== 13))
      throw new Error(t('error.png.invalidPngHeader'));
    if (type === 'acTL') throw new Error(t('error.png.aStaticPngNotApng'));
    if (type === 'IDAT') compressed.push(bytes.subarray(offset + 8, end - 4));
    if (type === 'IEND') {
      if (length !== 0 || end !== bytes.length) throw new Error(t('error.png.invalidPngEnding'));
      ended = true;
      break;
    }
    offset = end;
  }
  if (!ended || !compressed.length) throw new Error(t('error.png.thePngDoesNotContain'));
  try {
    inflateSync(Buffer.concat(compressed), { maxOutputLength: 128 * 1024 ** 2 });
  } catch {
    throw new Error(t('error.png.thePngIsDamagedOr'));
  }
}
