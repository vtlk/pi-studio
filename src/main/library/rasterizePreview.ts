import { BrowserWindow } from 'electron';
import type { PreviewRenderer } from './previewOptions';
import { clampCamera } from '../../shared/camera';

/** A trusted inert image document, never an agent HTML/JS/TSX page or browser session. */
export const rasterizePreview: PreviewRenderer = async (source, frame) => {
  if (!/^data:image\/(png|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(source))
    throw new Error('Неподдерживаемый источник кадра.');
  const window = new BrowserWindow({
    show: false,
    frame: false,
    width: frame.width,
    height: frame.height,
    useContentSize: true,
    transparent: frame.transparent,
    backgroundColor: frame.transparent ? '#00000000' : '#ffffff',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true,
      backgroundThrottling: false,
      partition: 'pistudio-library-preview',
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  const timeout = setTimeout(() => window.destroy(), 10000);
  try {
    await window.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(
          `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}img{width:100%;height:100%;object-fit:contain}</style><img src="${source}">`,
        ),
    );
    const size = await window.webContents.executeJavaScript(
      "document.querySelector('img').decode().then(()=>({width:document.images[0].naturalWidth,height:document.images[0].naturalHeight}))",
    );
    const camera = clampCamera(frame.camera ?? { zoom: 1, x: 0, y: 0 }, frame, size);
    await window.webContents.executeJavaScript(
      `document.images[0].style.transform=${JSON.stringify(`translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})`)};new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`,
    );
    return (await window.webContents.capturePage())
      .resize({ width: frame.width, height: frame.height, quality: 'best' })
      .toPNG({ scaleFactor: 1 });
  } finally {
    clearTimeout(timeout);
    if (!window.isDestroyed()) window.destroy();
  }
};
