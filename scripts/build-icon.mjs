import { mkdtemp, mkdir, rm } from 'node:fs/promises';
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
