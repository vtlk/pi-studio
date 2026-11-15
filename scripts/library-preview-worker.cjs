const { app, BrowserWindow } = require('electron');
const { writeFile } = require('node:fs/promises');
const { join, resolve } = require('node:path');

// Owned QA process: only the production inert data-image renderer, no app/window control tools.
app.setActivationPolicy('accessory');
app.on('window-all-closed', () => {});
(async () => {
  const directory = process.env.PI_STUDIO_QA_RENDER_DIRECTORY;
  if (!directory || !process.send) throw Error('An owned render directory and IPC are required');
  app.setPath('userData', join(directory, 'RendererData'));
  require('./offscreen-main.cjs').configureQaRuntime();
  const input = join(directory, 'renderer-entry.ts');
  const output = join(directory, 'renderer.cjs');
  await writeFile(
    input,
    `export {rasterizePreview} from ${JSON.stringify(resolve('src/main/library/rasterizePreview.ts'))};`,
  );
  const { build } = await import('rolldown');
  await build({
    input,
    platform: 'node',
    external: ['electron'],
    output: { file: output, format: 'cjs' },
  });
  await app.whenReady();
  const render = require(output).rasterizePreview;
  process.on('message', async (message) => {
    if (message.close) {
      for (const window of BrowserWindow.getAllWindows()) window.destroy();
      app.exit(0);
      return;
    }
    try {
      const bytes = await render(message.source, message.frame);
      process.send({ id: message.id, data: bytes.toString('base64') });
    } catch (error) {
      process.send({ id: message.id, error: String(error) });
    }
  });
  process.on('disconnect', () => app.exit(0));
  process.send({ ready: true });
})().catch((error) => {
  console.error(error);
  app.exit(1);
});
