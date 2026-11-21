import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

test('overlapping chats and a later dictation reuse one prepared voice worker', async () => {
  let workers = 0;
  let modelChecks = 0;
  const commands: string[] = [];
  const idleCallbacks: (() => void)[] = [];
  class Worker {
    onmessage?: (event: { data: { id: number; text?: string } }) => void;
    constructor() {
      workers++;
    }
    postMessage({ id, command }: { id: number; command: string }) {
      commands.push(command);
      queueMicrotask(() => this.onmessage?.({ data: { id, text: 'Transcript' } }));
    }
    terminate() {}
  }
  const source = await readFile(
    new URL('../src/renderer/features/voice/voiceEngine.ts', import.meta.url),
    'utf8',
  );
  const engine = runInNewContext(
    stripTypeScriptTypes(source.replace(/^import .*;\n/gm, '').replaceAll('export ', '')) +
      '\n({ prepareVoice, transcribeVoice, isVoiceReady });',
    {
      Worker,
      window: {
        studio: {
          async prepareVoiceModel() {
            modelChecks++;
          },
        },
      },
      t: (key: string) => key,
      setTimeout: (callback: () => void) => idleCallbacks.push(callback),
      clearTimeout() {},
    },
  );
  await Promise.all([engine.prepareVoice(), engine.prepareVoice()]);
  assert.equal(await engine.transcribeVoice(new Float32Array([0])), 'Transcript');
  idleCallbacks.forEach((callback) => callback());
  assert.equal(engine.isVoiceReady(), true);
  await engine.prepareVoice();
  assert.equal(await engine.transcribeVoice(new Float32Array([1])), 'Transcript');
  assert.deepEqual(commands, ['load', 'transcribe', 'transcribe']);
  assert.equal(workers, 1);
  assert.equal(modelChecks, 1);
});
