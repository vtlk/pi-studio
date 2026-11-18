import { mkdir, open, rename, rm, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import model from './model.json' with { type: 'json' };
import type { VoiceModelState } from '../../shared/voice.ts';
import { t } from '../../shared/i18n/index.ts';

/** App-owned, hash-pinned model cache independent of any studio or installed app version. */
export class VoiceModels {
  private state: VoiceModelState;
  private task?: Promise<void>;
  private controller?: AbortController;
  readonly root: string;
  private fetcher: typeof fetch;
  private manifest: typeof model;
  constructor(root: string, fetcher: typeof fetch = fetch, manifest = model) {
    this.root = root;
    this.fetcher = fetcher;
    this.manifest = manifest;
    this.state = {
      phase: 'idle',
      downloaded: 0,
      total: manifest.files.reduce((sum, file) => sum + file.bytes, 0),
    };
  }
  read() {
    return { ...this.state };
  }
  prepare() {
    if (this.state.phase === 'ready') return Promise.resolve();
    if (this.task) return this.task;
    const controller = (this.controller = new AbortController());
    this.state = { ...this.state, phase: 'downloading', downloaded: 0 };
    this.task = this.download(controller.signal)
      .then(() => {
        this.state.phase = 'ready';
      })
      .catch((error) => {
        this.state.phase = controller.signal.aborted ? 'idle' : 'error';
        throw new Error(t(controller.signal.aborted ? 'Voice.cancelled' : 'Voice.downloadFailed'), {
          cause: error,
        });
      })
      .finally(() => {
        this.task = undefined;
        this.controller = undefined;
      });
    return this.task;
  }
  async close() {
    this.controller?.abort();
    await this.task?.catch(() => {});
  }
  private async verified(file: (typeof model.files)[number]) {
    try {
      const input = await open(
        join(this.root, file.name),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const info = await input.stat();
        if (!info.isFile() || info.size !== file.bytes) return false;
        const hash = createHash('sha256');
        for await (const part of input.createReadStream({ autoClose: false })) hash.update(part);
        return hash.digest('hex') === file.sha256;
      } finally {
        await input.close();
      }
    } catch {
      return false;
    }
  }
  private async download(signal: AbortSignal) {
    for (const file of this.manifest.files) {
      signal.throwIfAborted();
      if (await this.verified(file)) {
        this.state.downloaded += file.bytes;
        continue;
      }
      const target = join(this.root, file.name),
        temporary = target + '.download';
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await rm(temporary, { force: true });
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort, { once: true });
      let timer = setTimeout(abort, 30_000);
      try {
        const response = await this.fetcher(
          `https://huggingface.co/${this.manifest.repo}/resolve/${this.manifest.revision}/${file.name}`,
          { signal: controller.signal },
        );
        clearTimeout(timer);
        if (!response.ok || !response.body) throw Error('model-response');
        const hash = createHash('sha256'),
          output = await open(temporary, 'wx', 0o600);
        let size = 0;
        const reader = response.body.getReader();
        try {
          while (true) {
            timer = setTimeout(abort, 60_000);
            const part = await reader.read();
            clearTimeout(timer);
            if (part.done) break;
            signal.throwIfAborted();
            size += part.value.length;
            if (size > file.bytes) throw Error('model-size');
            hash.update(part.value);
            await output.writeFile(part.value);
            this.state.downloaded += part.value.length;
          }
          if (size !== file.bytes || hash.digest('hex') !== file.sha256) throw Error('model-hash');
          await output.sync();
        } finally {
          await reader.cancel().catch(() => {});
          await output.close();
        }
        signal.throwIfAborted();
        await rename(temporary, target);
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        controller.abort();
        await rm(temporary, { force: true });
      }
    }
  }
  async response(request: Request) {
    const url = new URL(request.url);
    let decoded: string;
    try {
      decoded = decodeURIComponent(url.pathname);
    } catch {
      return new Response(null, { status: 404 });
    }
    const name = decoded.replace(/^\//, '').replace(this.manifest.repo + '/', '');
    const file = this.manifest.files.find((file) => file.name === name);
    if (url.hostname !== 'models' || !file || !['GET', 'HEAD'].includes(request.method))
      return new Response(null, { status: 404 });
    try {
      const path = join(this.root, file.name),
        info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== file.bytes)
        return new Response(null, { status: 404 });
      const input = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const headers = {
        'Content-Type': file.name.endsWith('.json')
          ? 'application/json'
          : 'application/octet-stream',
        'Content-Length': String(file.bytes),
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      };
      if (request.method === 'HEAD') {
        await input.close();
        return new Response(null, { headers });
      }
      return new Response(Readable.toWeb(input.createReadStream()) as ReadableStream<Uint8Array>, {
        headers,
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  }
}
