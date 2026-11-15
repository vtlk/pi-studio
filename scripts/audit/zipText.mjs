import { open } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

/** Bounded read only access: never extracts paths or writes a ZIP entry to the filesystem. */
export async function readZipText(archive, entry, max = 16 * 1024 ** 2) {
  const file = await open(archive, 'r');
  async function bytes(offset, size) {
    if (offset < 0 || size < 0 || offset + size > length) throw Error('ZIP range outside archive.');
    const data = Buffer.alloc(size);
    if ((await file.read(data, 0, size, offset)).bytesRead !== size) throw Error('Truncated ZIP.');
    return data;
  }
  const length = (await file.stat()).size;
  try {
    const tailSize = Math.min(length, 65557),
      tail = await bytes(length - tailSize, tailSize);
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--)
      if (
        tail.readUInt32LE(i) === 0x06054b50 &&
        i + 22 + tail.readUInt16LE(i + 20) === tail.length
      ) {
        end = i;
        break;
      }
    if (end < 0 || tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6))
      throw Error('Unsupported ZIP end record.');
    const count = tail.readUInt16LE(end + 10),
      offset = tail.readUInt32LE(end + 16),
      size = tail.readUInt32LE(end + 12);
    if (count === 65535 || size > 16 * 1024 ** 2 || offset + size > length - tailSize + end)
      throw Error('Unsupported ZIP directory.');
    const directory = await bytes(offset, size);
    let cursor = 0,
      selected;
    for (let index = 0; index < count; index++) {
      if (cursor + 46 > directory.length || directory.readUInt32LE(cursor) !== 0x02014b50)
        throw Error('Invalid ZIP directory entry.');
      const nameLength = directory.readUInt16LE(cursor + 28),
        extra = directory.readUInt16LE(cursor + 30),
        comment = directory.readUInt16LE(cursor + 32);
      const next = cursor + 46 + nameLength + extra + comment;
      if (next > directory.length) throw Error('Truncated ZIP directory entry.');
      const name = directory.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
      if (name === entry) {
        if (selected !== undefined) throw Error('Ambiguous duplicate ZIP entry name.');
        selected = cursor;
      }
      cursor = next;
    }
    if (selected !== undefined) {
      const cursor = selected;
      const flags = directory.readUInt16LE(cursor + 8),
        method = directory.readUInt16LE(cursor + 10),
        compressed = directory.readUInt32LE(cursor + 20),
        uncompressed = directory.readUInt32LE(cursor + 24),
        localOffset = directory.readUInt32LE(cursor + 42);
      if (flags & 1 || compressed > max || uncompressed > max || ![0, 8].includes(method))
        throw Error('Unsupported or oversized ZIP text.');
      const local = await bytes(localOffset, 30);
      if (
        local.readUInt32LE(0) !== 0x04034b50 ||
        local.readUInt16LE(8) !== method ||
        local.readUInt16LE(6) !== flags
      )
        throw Error('Invalid ZIP local header.');
      const localName = await bytes(localOffset + 30, local.readUInt16LE(26));
      if (localName.toString('utf8') !== entry) throw Error('Inconsistent ZIP local entry name.');
      const data = await bytes(
        localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28),
        compressed,
      );
      const result = method === 8 ? inflateRawSync(data, { maxOutputLength: max }) : data;
      if (result.length !== uncompressed) throw Error('Invalid ZIP text size.');
      return result;
    }
    return undefined;
  } finally {
    await file.close();
  }
}
