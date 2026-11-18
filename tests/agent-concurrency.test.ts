import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { readProjectScope } from '../src/main/storage/projectReadScope.ts';
import { loadOutput, scanOutputs } from '../src/main/storage/outputs.ts';
import { OutputReadQueue } from '../src/renderer/features/project/model/OutputReadQueue.ts';
import { checkRunLiveness } from '../src/main/pi/runLiveness.ts';
const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const settle = () => new Promise<void>((r) => setImmediate(r));
async function fixture(t: any) {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-concurrent-agent-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
  const store = await service.load();
  const agents = ['a', 'b'].map((id) => ({
    id,
    name: id,
    enabled: true,
    instructions: [],
    skills: [],
    mcps: [],
    plugins: [],
  }));
  const project = (await store.command({ kind: 'create', name: 'Concurrency', agents }))
    .projects[0];
  return { service, store, project, root: await store.projects.directory(project.id) };
}
test('file previews and project reads finish while another studio operation is still pending', async (t) => {
  const f = await fixture(t);
  const hold = deferred();
  const pending = f.service.serialize(() => hold.promise);
  const file = f.project.agents[1].outputPath + '/ready.md';
  await writeFile(join(f.root, file), 'B result');
  try {
    const preview = await readProjectScope(f.service, f.project.id, (_s, root) =>
      loadOutput(root, file),
    );
    assert.equal(preview.content, 'B result');
    const view = await readProjectScope(f.service, f.project.id, (s, _r, signal) =>
      s.projects.read(f.project.id, signal),
    );
    assert.ok(view.agents[1].entries.length);
  } finally {
    hold.resolve();
    await pending;
  }
});
test('runtime status updates never scan another agent tree, and preserve the latest cached preview tree', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.root, f.project.agents[1].outputPath, 'ready.md'), 'Result');
  const view = await f.store.projects.read(f.project.id);
  assert.ok(view.agents[1].entries.length);
  const update = await f.store.projects.updateRuntime(f.project.id, 'a', 'running');
  assert.deepEqual(update.agents[1].entries, view.agents[1].entries);
  assert.equal(update.agents[0].runStatus, 'running');
  // A deliberately unreadable/overdeep tree must not be visited by a status-only write.
  await mkdir(join(f.root, f.project.agents[0].outputPath, ...Array(23).fill('nested')), {
    recursive: true,
  });
  await f.store.projects.updateRuntime(f.project.id, 'a', 'waiting');
});
test('dependency trees are excluded from previews and cancelled scans stop without touching files', async (t) => {
  const f = await fixture(t),
    output = f.project.agents[0].outputPath;
  await mkdir(join(f.root, output, 'node_modules/dependency'), { recursive: true });
  await writeFile(join(f.root, output, 'node_modules/dependency/index.js'), 'dependency');
  await writeFile(join(f.root, output, 'result.md'), 'result');
  const entries = await scanOutputs(f.root, output);
  assert.deepEqual(
    entries.map((x) => x.name),
    ['result.md'],
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    scanOutputs(f.root, output, { remaining: 5000, signal: controller.signal }),
    { name: 'AbortError' },
  );
});
test('fingerprint changes during a read keep the completed preview and coalesce to the latest version', async () => {
  const reads = [deferred<string>(), deferred<string>()];
  let count = 0;
  const results: string[] = [];
  const queue = new OutputReadQueue(
    () => reads[count++].promise,
    (file) => {
      if (file) results.push(file);
    },
  );
  queue.request('one');
  queue.request('two');
  queue.request('three');
  assert.equal(count, 1);
  reads[0].resolve('snapshot one');
  await settle();
  assert.deepEqual(results, ['snapshot one']);
  assert.equal(count, 2);
  reads[1].resolve('snapshot three');
  await settle();
  assert.deepEqual(results, ['snapshot one', 'snapshot three']);
  assert.equal(count, 2);
  queue.close();
});
test('changing the selected agent closes its old preview reader; late responses never replace the new preview', async () => {
  const read = deferred<string>();
  const results: string[] = [];
  const queue = new OutputReadQueue(
    () => read.promise,
    (file) => {
      if (file) results.push(file);
    },
  );
  queue.request('a');
  queue.close();
  read.resolve('old agent');
  await settle();
  assert.deepEqual(results, []);
});
test('an alive owned Pi is not killed or replaced because its Studio heartbeat is delayed', async () => {
  let stopped = 0,
    lost = 0;
  const live: any = {
    pid: 2147483647,
    heartbeat: 0,
    embedded: { alive: true },
    stop() {
      stopped++;
    },
    run: { record: { runId: 'owned' } },
  };
  const state: any = {
    live: new Map([['p/a', live]]),
    retiring: new Map(),
    opening: new Set(),
    lifecycle: {
      processLost: async () => {
        lost++;
      },
    },
    dependencies: {},
    remove() {
      throw Error('Removed live process');
    },
  };
  await checkRunLiveness(state);
  assert.equal(stopped, 0);
  assert.equal(lost, 0);
  assert.equal(state.live.size, 1);
});

test('the actual chat IPC handler reads a working chat without waiting for studio persistence', async (t) => {
  const f = await fixture(t);
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const ts = (await import('typescript')).default;
  const { desktopChannels } = await import('../src/shared/contracts.ts');
  const { stableId } = await import('../src/main/storage/validation.ts');
  const { t: translate } = await import('../src/shared/i18n/index.ts');
  const exports: any = {};
  const handlers = new Map<string, Function>();
  const source = ts.transpileModule(await readFile('src/main/pi/registerChatHandlers.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(source, {
    exports,
    require: (name: string) => {
      if (name === 'node:path') return { join };
      if (name.includes('contracts')) return { desktopChannels };
      if (name.includes('desktopInvoke'))
        return { handleDesktopInvoke: (name: string, fn: Function) => handlers.set(name, fn) };
      if (name.includes('validation')) return { stableId };
      if (name.includes('i18n')) return { t: translate };
      throw Error('Unexpected privileged module ' + name);
    },
  });
  const state = { phase: 'ready', working: true, runId: 'current' };
  const host = { chatRoot: () => f.root, chat: () => state };
  exports.registerChatHandlers(f.service, host, host, () => ({}));
  const hold = deferred();
  const pending = f.service.serialize(() => hold.promise);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      handlers.get(desktopChannels.getChat)!({}, { projectId: f.project.id, agentId: 'a' }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error('Chat was serialized behind work')), 1000);
      }),
    ]);
    assert.deepEqual(result, state);
  } finally {
    clearTimeout(timer);
    hold.resolve();
    await pending;
  }
});

test('a studio change rejects an old file/media read and cancels an unopened response stream', async (t) => {
  const f = await fixture(t);
  const original = f.service.peek.bind(f.service);
  let cancelled = false;
  try {
    await assert.rejects(
      readProjectScope(
        f.service,
        f.project.id,
        async () => {
          const response = new Response(
            new ReadableStream({
              cancel() {
                cancelled = true;
              },
            }),
          );
          f.service.peek = () => undefined;
          return response;
        },
        async (response) => {
          await response.body?.cancel();
        },
      ),
    );
    assert.equal(cancelled, true);
  } finally {
    f.service.peek = original;
  }
});
