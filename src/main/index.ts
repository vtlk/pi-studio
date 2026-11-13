import { app, protocol } from 'electron';
import { join } from 'node:path';
import { createStudioWindow } from './windows/createStudioWindow';
import { registerDesktopHandlers } from './ipc/registerDesktopHandlers';
import { mediaResponse, streamMedia } from './storage/media';
import { libraryKind } from './library/manifest';
import packageInfo from '../../package.json';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'studio-media',
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

app.setName('Pi Studio');
if (process.platform !== 'darwin') {
  console.error('Pi Studio supports macOS only.');
  app.quit();
} else if (!app.requestSingleInstanceLock()) app.quit();
else
  app.whenReady().then(() => {
    app.setAboutPanelOptions({
      applicationName: 'Pi Studio',
      applicationVersion: packageInfo.version,
      version: packageInfo.version,
    });
    app.dock?.setIcon(
      join(
        __dirname,
        process.env.ELECTRON_RENDERER_URL
          ? '../../public/branding/pi-studio-icon.png'
          : '../renderer/branding/pi-studio-icon.png',
      ),
    );
    const service = registerDesktopHandlers();
    protocol.handle('studio-media', async (request) => {
      try {
        const url = new URL(request.url);
        if (url.hostname === 'library') {
          const [scope, kind, id, version, ...parts] = url.pathname
            .slice(1)
            .split('/')
            .map(decodeURIComponent);
          const media = await service.serialize(async () =>
            (await service.load()).library.media(
              scope,
              libraryKind(kind),
              id,
              Number(version),
              parts.join('/'),
            ),
          );
          return streamMedia(media.root, media.path, request);
        }
        if (url.hostname !== 'output') return new Response(null, { status: 403 });
        const [projectId, ...parts] = url.pathname.slice(1).split('/').map(decodeURIComponent);
        const root = await service.serialize(async () =>
          (await service.load()).projects.directory(projectId),
        );
        return await mediaResponse(root, parts.join('/'), request);
      } catch {
        return new Response(null, { status: 404 });
      }
    });
    createStudioWindow();
    app.on('activate', createStudioWindow);
  });
app.on('second-instance', () => {
  if (app.isReady()) createStudioWindow().focus();
});
app.on('window-all-closed', () => {
  // macOS keeps the application alive after its last window closes.
});
