import { t } from '../../shared/i18n/index.ts';
import { BrowserWindow, nativeImage } from 'electron';
import { readText } from '../storage/files';
import { validateStaticSvg } from './validateReferenceSvg';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** Only a validated image is decoded; no generated preview code is loaded. */
export async function referenceImage(path: string, type: string): Promise<Buffer> {
  if (type !== 'image/svg+xml') {
    let image = nativeImage.createFromPath(path);
    if (
      process.platform === 'darwin' &&
      image.isEmpty() &&
      /^image\/(heic|heif|tiff?|bmp)$/.test(type)
    ) {
      const directory = await mkdtemp(join(tmpdir(), 'pistudio-reference-'));
      try {
        const target = join(directory, 'reference.png');
        await promisify(execFile)('/usr/bin/sips', ['-s', 'format', 'png', path, '--out', target], {
          timeout: 20000,
          maxBuffer: 100000,
        });
        image = nativeImage.createFromPath(target);
      } catch {
        throw new Error(t('error.referenceImage.couldNotConvertToPng', { value1: type }));
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
    if (image.isEmpty())
      throw new Error(t('error.referenceImage.couldNotConvertToPng', { value1: type }));
    const size = image.getSize();
    if (size.width > 16384 || size.height > 16384)
      throw new Error(t('error.referenceImage.theImageExceedsPixels'));
    return image.toPNG();
  }
  const svg = await readText(path);
  validateStaticSvg(svg);
  const window = new BrowserWindow({
    show: false,
    width: 1024,
    height: 1024,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  try {
    const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    await window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>html,body{margin:0;background:transparent}img{width:1024px;height:1024px;object-fit:contain}</style><img src="${src}">`)}`,
    );
    await window.webContents.executeJavaScript(
      "document.querySelector('img').decode().then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))",
    );
    return (await window.webContents.capturePage()).toPNG();
  } finally {
    window.destroy();
  }
}
