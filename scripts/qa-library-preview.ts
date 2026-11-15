import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { PreviewRenderer } from '../src/main/library/previewOptions.ts';

/** Owned accessory Electron process; renders inert library data through production code. */
export async function qaLibraryPreview(root: string) {
  await mkdir(join(root, 'RendererData'), { recursive: true });
  const electron = (await import('electron')).default as unknown as string;
  const child = spawn(electron, ['scripts/library-preview-worker.cjs'], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    env: { ...process.env, PI_STUDIO_QA_RENDER_DIRECTORY: root, ELECTRON_RUN_AS_NODE: '' },
  });
  let stderr = '',
    next = 0;
  child.stderr!.on('data', (bytes) => {
    stderr = (stderr + bytes.toString()).slice(-4000);
  });
  const exit = new Promise((done) => child.once('exit', done));
  const pending = new Map<number, { resolve(bytes: Buffer): void; reject(error: Error): void }>();
  const ready = new Promise<void>((done, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(Error('Preview worker startup timed out'));
    }, 15000);
    child.on(
      'message',
      (message: { ready?: boolean; id: number; data?: string; error?: string }) => {
        if (message.ready) {
          clearTimeout(timer);
          done();
          return;
        }
        const request = pending.get(message.id);
        if (message.error) request?.reject(Error(message.error));
        else if (message.data) request?.resolve(Buffer.from(message.data, 'base64'));
      },
    );
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      const error = Error(`Preview worker exited: ${code}; ${stderr}`);
      reject(error);
      for (const request of pending.values()) request.reject(error);
    });
  });
  await ready;
  let frames = 0;
  const render: PreviewRenderer = (source, frame) =>
    new Promise((resolve, reject) => {
      frames++;
      const id = ++next;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error('Library preview timed out'));
      }, 15000);
      pending.set(id, {
        resolve: (bytes) => {
          clearTimeout(timer);
          pending.delete(id);
          resolve(bytes);
        },
        reject: (error) => {
          clearTimeout(timer);
          pending.delete(id);
          reject(error);
        },
      });
      child.send({ id, source, frame });
    });
  return {
    render,
    frames: () => frames,
    close: async () => {
      if (child.exitCode !== null) return;
      if (child.connected) child.send({ close: true });
      const timer = setTimeout(() => child.kill('SIGTERM'), 3000);
      await exit;
      clearTimeout(timer);
    },
  };
}
