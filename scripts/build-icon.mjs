import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

if (process.platform !== 'darwin') throw new Error('ICNS generation requires macOS.');
const root = resolve(import.meta.dirname, '..');
const temporary = await mkdtemp(join(tmpdir(), 'pistudio-icon-'));
const iconset = join(temporary, 'PiStudio.iconset');
await mkdir(iconset);
try {
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const pixels = String(size * scale);
      execFileSync(
        '/usr/bin/sips',
        [
          '-z',
          pixels,
          pixels,
          join(root, 'public/branding/pi-studio-icon.png'),
          '--out',
          join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`),
        ],
        { stdio: 'pipe' },
      );
    }
  }
  const images = [];
  for (const size of [16, 24, 32, 48, 64, 128, 256]) {
    const path = join(temporary, `windows-${size}.png`);
    execFileSync(
      '/usr/bin/sips',
      [
        '-z',
        String(size),
        String(size),
        join(root, 'public/branding/pi-studio-icon.png'),
        '--out',
        path,
      ],
      { stdio: 'pipe' },
    );
    images.push({ size, png: await readFile(path) });
  }
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const entry = 6 + i * 16;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  await writeFile(
    join(root, 'public/branding/pi-studio.ico'),
    Buffer.concat([header, ...images.map(({ png }) => png)]),
  );
  await mkdir(join(root, 'build'), { recursive: true });
  execFileSync('/usr/bin/iconutil', [
    '-c',
    'icns',
    iconset,
    '-o',
    join(root, 'build/PiStudio.icns'),
  ]);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
