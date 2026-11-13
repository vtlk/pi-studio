import { crc32, inflateSync } from 'node:zlib';

export function validatePngBytes(bytes: Buffer) {
  if (
    bytes.length < 57 ||
    bytes.length > 32 * 1024 ** 2 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.toString('ascii', 12, 16) !== 'IHDR'
  )
    throw new Error('Некорректный PNG материала.');
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  if (!width || !height || width > 16384 || height > 16384)
    throw new Error('Размер PNG вне поддерживаемого диапазона.');
  const compressed: Buffer[] = [];
  let offset = 8,
    ended = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset),
      end = offset + 12 + length;
    if (end > bytes.length) throw new Error('PNG обрезан.');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4))
      throw new Error('Контрольная сумма PNG не совпадает.');
    if (offset === 8 && (type !== 'IHDR' || length !== 13))
      throw new Error('Некорректный заголовок PNG.');
    if (type === 'acTL') throw new Error('Для эталона и превью нужен статичный PNG, не APNG.');
    if (type === 'IDAT') compressed.push(bytes.subarray(offset + 8, end - 4));
    if (type === 'IEND') {
      if (length !== 0 || end !== bytes.length) throw new Error('Некорректное завершение PNG.');
      ended = true;
      break;
    }
    offset = end;
  }
  if (!ended || !compressed.length) throw new Error('PNG не содержит полного изображения.');
  try {
    inflateSync(Buffer.concat(compressed), { maxOutputLength: 128 * 1024 ** 2 });
  } catch {
    throw new Error('PNG повреждён или превышает 128 МБ в распакованном виде.');
  }
}
