import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

/** Small generated fixture only; never installed or seeded into a user's library. */
export function libraryPng() {
  const chunk = (name, data) => {
    const type = Buffer.from(name),
      head = Buffer.alloc(4),
      crc = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
    return Buffer.concat([head, type, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(32, 0);
  header.writeUInt32BE(24, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc(24 * (1 + 32 * 4));
  for (let y = 0; y < 24; y++)
    for (let x = 0; x < 32; x++) {
      const index = y * 129 + 1 + x * 4;
      rows.set([x < 16 ? 240 : 30, y < 12 ? 190 : 80, 50, 255], index);
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
export async function writeLibraryFixture(prepared, { vector = true } = {}) {
  const root = prepared.stagingDirectory;
  await writeFile(join(root, 'reference.png'), libraryPng());
  await writeFile(join(root, 'preview.png'), libraryPng());
  if (vector) {
    await writeFile(
      join(root, 'art.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 24"><rect width="32" height="24" fill="#f0be32"/><circle cx="16" cy="12" r="7" fill="#193840"/></svg>',
    );
    await writeFile(
      join(root, 'asset.json'),
      JSON.stringify({
        ...prepared.manifest,
        files: { ...prepared.manifest.files, vector: 'art.svg' },
      }),
    );
  }
}
