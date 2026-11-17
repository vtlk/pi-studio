import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, writeFile, rm, access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resourceChild } from '../src/main/pi/resourceChild.ts';
import { nativeResourceOperation } from '../src/main/pi/NativeResources.ts';
import { changeLanguage } from '../src/shared/i18n/index.ts';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { StudioResources } from '../src/main/pi/StudioResources.ts';
import { SetupAdministration } from '../src/main/pi/SetupAdministration.ts';
import type { PreparedRun } from '../src/main/pi/ContextBuilder.ts';
import { parseAgent } from '../src/main/storage/validation.ts';
import { nodeTools } from '../bundled/pi-bridge/node-tools.mjs';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { RunChannel, type SessionEnvelope } from '../src/main/pi/RunChannel.ts';
import { setupTools } from '../src/main/pi/setupTools.ts';

const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
async function until(check: () => Promise<boolean>, timeout = 4000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await pause(20);
  }
  throw Error('QA condition did not become true');
}
const exists = async (path: string) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};
const options = (root: string) => ({
  node: process.execPath,
  args: [],
  cwd: root,
  env: process.env,
  input: '{}',
  timeout: 10000,
});

test('pre-cancelled native operations never inspect or launch Pi', async () => {
  const signal = AbortSignal.abort();
  await assert.rejects(
    nativeResourceOperation(
      '/invalid/never-execute',
      '/invalid/script',
      { action: 'install-package', cwd: '/invalid' },
      signal,
    ),
    { name: 'AbortError' },
  );
});

test('resource helper isolates payload from stdout/stderr and releases cancellation after actual close', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-resource-child-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const controller = new AbortController();
  const payload = JSON.stringify({ ok: true, result: { status: 'available' } });
  const result = await resourceChild({
    ...options(root),
    signal: controller.signal,
    args: [
      '-e',
      `console.error('QA_STDERR_NEVER_LEAK');console.log('QA_STDOUT_NEVER_LEAK');require('node:fs').writeSync(3,${JSON.stringify(payload)})`,
    ],
  });
  assert.equal(result.code, 0);
  assert.equal(result.output, payload);
  controller.abort();
});

test('UTF-8 metadata survives a pipe chunk split inside a character', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-resource-utf8-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const text = '{"ok":true,"name":"Настройки 🛠️"}';
  const bytes = Buffer.from(text);
  const split = bytes.indexOf(Buffer.from('Н')) + 1;
  const result = await resourceChild({
    ...options(root),
    args: [
      '-e',
      `const fs=require('node:fs'),b=Buffer.from(${JSON.stringify(text)});fs.writeSync(3,b.subarray(0,${split}));setTimeout(()=>fs.writeSync(3,b.subarray(${split})),30)`,
    ],
  });
  assert.equal(result.output, text);
});

for (const ignoreRootTerm of [false, true])
  test(
    `cancelling stops only the owned installer group, including descendants (root ignores TERM: ${ignoreRootTerm})`,
    { timeout: 15000, skip: process.platform === 'win32' },
    async (t) => {
      const root = await mkdtemp(join(tmpdir(), 'pistudio-resource-stop-'));
      let ownedPid: number | undefined;
      const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
        stdio: 'ignore',
      });
      t.after(async () => {
        unrelated.kill('SIGKILL');
        if (ownedPid) {
          try {
            process.kill(-ownedPid, 'SIGKILL');
          } catch {}
        }
        await changeLanguage('ru');
        await rm(root, { recursive: true, force: true });
      });
      const pidFile = join(root, 'owned-pids.json'),
        ready = join(root, 'descendant-ready'),
        ticks = join(root, 'ticks');
      const descendant = `const fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>fs.appendFileSync(${JSON.stringify(ticks)},'x'),10)`;
      const script = join(root, 'owned-installer.cjs');
      await writeFile(
        script,
        `const fs=require('node:fs');const {spawn}=require('node:child_process');${ignoreRootTerm ? "process.on('SIGTERM',()=>{});" : ''}const child=spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pidFile)},JSON.stringify({parent:process.pid,child:child.pid}));setInterval(()=>{},1000);`,
      );
      const controller = new AbortController();
      const language = ignoreRootTerm ? 'en' : 'ru';
      await changeLanguage(language);
      const promise = resourceChild({
        ...options(root),
        args: [script],
        signal: controller.signal,
      });
      await until(
        async () => (await exists(pidFile)) && (await exists(ready)) && (await exists(ticks)),
      );
      const pids = JSON.parse(await readFile(pidFile, 'utf8'));
      ownedPid = pids.parent;
      const rejected = assert.rejects(
        promise,
        (error: Error) =>
          error.name === 'AbortError' &&
          (language === 'ru'
            ? error.message.includes('отменена')
            : error.message.includes('cancelled')),
      );
      controller.abort();
      await rejected;
      await pause(80);
      const count = (await readFile(ticks, 'utf8')).length;
      await pause(80);
      assert.equal(
        (await readFile(ticks, 'utf8')).length,
        count,
        'A cancelled descendant must not keep installing/writing',
      );
      assert.throws(() => process.kill(pids.parent, 0));
      assert.doesNotThrow(
        () => process.kill(unrelated.pid!, 0),
        'An unrelated process must survive',
      );
    },
  );

test(
  'deadline and oversized payload stop the helper before rejecting with safe localized errors',
  { timeout: 10000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'pistudio-resource-limits-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await assert.rejects(
      resourceChild({ ...options(root), timeout: 30, args: ['-e', 'setInterval(()=>{},1000)'] }),
      /Pi не завершил/,
    );
    await assert.rejects(
      resourceChild({
        ...options(root),
        args: ['-e', "require('node:fs').writeSync(3,'x'.repeat(500001));setInterval(()=>{},1000)"],
      }),
      /слишком|превыш|ответ/i,
    );
  },
);

test('cancelled or revoked installation results cannot publish a resource after native completion', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-resource-publication-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const mode of ['cancel', 'revoke']) {
    const service = new StudioService(join(root, mode + '-prefs.json'), join(root, mode));
    const store = await service.load();
    const controller = new AbortController();
    let allowed = true,
      calls = 0;
    const native = new StudioResources(service, {
      script: '',
      piPath: () => '',
      operation: async (_pi, _script, request, signal) => {
        assert.equal(request.action, 'install-package');
        assert.equal(signal, controller.signal);
        calls++;
        if (mode === 'cancel') controller.abort();
        else allowed = false;
        return { status: 'available', version: '1' };
      },
    });
    const permission = async () => {
      if (!allowed) throw Error('QA assignment revoked');
    };
    await assert.rejects(
      native.installPackage(
        store.folder,
        'npm:qa-fixture@1.0.0',
        'QA',
        controller.signal,
        permission,
      ),
    );
    assert.equal(calls, 1);
    assert.deepEqual(store.bootstrap().sections.resources, []);
  }
});

test('Administration propagates the exact MCP cancellation signal to package installation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-resource-admin-cancel-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new StudioService(join(root, 'prefs.json'), join(root, 'studio'));
  const store = await service.load();
  const controller = new AbortController();
  const native = new StudioResources(service, {
    script: '',
    piPath: () => '',
    operation: async (_pi, _script, _request, signal) => {
      assert.equal(signal, controller.signal);
      controller.abort();
      throw controller.signal.reason;
    },
  });
  const admin = new SetupAdministration(
    service,
    async () => {
      throw Error('No model call required');
    },
    native,
  );
  await assert.rejects(
    admin.call(
      { projectRoot: join(store.folder, '.pistudio/setup-assistant') } as PreparedRun,
      'install_package',
      { source: 'npm:qa-fixture@1' },
      controller.signal,
    ),
    { name: 'AbortError' },
  );
  assert.deepEqual(store.bootstrap().sections.resources, []);
});

test('revoking the actual ordinary agent Administration assignment during install preserves catalog and project', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-resource-revoke-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new StudioService(join(root, 'prefs.json'), join(root, 'studio'));
  const store = await service.load();
  const agent = parseAgent({
    id: 'qa-installer',
    name: 'QA installer',
    enabled: true,
    instructions: [],
    skills: [],
    mcps: ['pistudio-project', 'pistudio-administration'],
    plugins: [],
  });
  await store.saveSection('agents', [agent]);
  const project = (await store.command({ kind: 'create', name: 'QA', agents: [agent] }))
    .projects[0];
  const directory = await store.projects.directory(project.id),
    before = await readFile(join(directory, 'project.json'));
  let entered!: () => void, finish!: () => void;
  const started = new Promise<void>((done) => (entered = done)),
    pending = new Promise<void>((done) => (finish = done));
  const native = new StudioResources(service, {
    script: '',
    piPath: () => '',
    operation: async () => {
      entered();
      await pending;
      return { status: 'available' };
    },
  });
  const admin = new SetupAdministration(
    service,
    async () => ({ providers: [], models: [] }),
    native,
  );
  const result = admin.call(
    { projectRoot: directory, project, agent: project.agents[0] } as PreparedRun,
    'install_package',
    { source: 'npm:qa-fixture@1' },
  );
  const rejected = assert.rejects(result);
  await started;
  await service.serialize(() =>
    store.saveSection('agents', [
      { ...agent, capabilitySettings: { 'mcps:pistudio-administration': { enabled: false } } },
    ]),
  );
  finish();
  await rejected;
  assert.deepEqual(store.bootstrap().sections.resources, []);
  assert.deepEqual(await readFile(join(directory, 'project.json')), before);
});

test('cancellation while catalog publication is queued cannot save a late result', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-resource-queued-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new StudioService(join(root, 'prefs.json'), join(root, 'studio'));
  const store = await service.load();
  const controller = new AbortController();
  let entered!: () => void,
    releaseOperation!: () => void,
    releaseQueue!: () => void,
    queueEntered!: () => void;
  const started = new Promise<void>((done) => (entered = done)),
    operation = new Promise<void>((done) => (releaseOperation = done)),
    queue = new Promise<void>((done) => (releaseQueue = done)),
    blocked = new Promise<void>((done) => (queueEntered = done));
  const native = new StudioResources(service, {
    script: '',
    piPath: () => '',
    operation: async () => {
      entered();
      await operation;
      return { status: 'available' };
    },
  });
  const result = native.installPackage(store.folder, 'npm:qa-fixture@1', 'QA', controller.signal);
  const rejected = assert.rejects(result, { name: 'AbortError' });
  await started;
  const held = service.serialize(async () => {
    queueEntered();
    await queue;
  });
  await blocked;
  releaseOperation();
  await pause(10);
  controller.abort();
  releaseQueue();
  await held;
  await rejected;
  assert.deepEqual(store.bootstrap().sections.resources, []);
});

test(
  'unconfirmed owned-process termination is explicit in RU and EN, without a false cancellation success',
  { skip: process.platform === 'win32' },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'pistudio-resource-stop-failure-'));
    t.after(async () => {
      await changeLanguage('ru');
      await rm(root, { recursive: true, force: true });
    });
    for (const [language, expected] of [
      ['ru', /Не удалось подтвердить/],
      ['en', /Could not confirm/],
    ] as const) {
      await changeLanguage(language);
      const file = join(root, language + '-pid');
      const controller = new AbortController();
      const result = resourceChild({
        ...options(root),
        signal: controller.signal,
        args: [
          '-e',
          `require('node:fs').writeFileSync(${JSON.stringify(file)},String(process.pid));setInterval(()=>{},1000)`,
        ],
      });
      const rejected = assert.rejects(result, expected);
      await until(() => exists(file));
      const pid = Number(await readFile(file, 'utf8'));
      const original = process.kill.bind(process);
      try {
        process.kill = ((target: number, signal?: NodeJS.Signals | number) => {
          if (target === -pid) throw Object.assign(Error('QA stop denied'), { code: 'EPERM' });
          return original(target, signal);
        }) as typeof process.kill;
        controller.abort();
        await rejected;
      } finally {
        process.kill = original;
        try {
          original(-pid, 'SIGKILL');
        } catch {}
      }
    }
  },
);

test(
  'actual Pi/npm lifecycle installation is cancelled without publishing or leaving a writing child',
  { timeout: 60000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'pistudio-native-install-cancel-'));
    const keys = [
      'PI_CODING_AGENT_DIR',
      'npm_config_cache',
      'npm_config_offline',
      'PI_STUDIO_QA_INSTALL_MARKER',
    ];
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    const marker = join(root, 'lifecycle-pid'),
      ticks = join(root, 'lifecycle-ticks');
    Object.assign(process.env, {
      PI_CODING_AGENT_DIR: join(root, 'native'),
      npm_config_cache: join(root, 'npm-cache'),
      npm_config_offline: 'true',
      PI_STUDIO_QA_INSTALL_MARKER: marker,
    });
    let controller: AbortController | undefined;
    const channel = new RunChannel();
    const completed = Promise.withResolvers<void>();
    let started = false;
    let failure: unknown;
    t.after(async () => {
      controller?.abort();
      channel.close();
      if (started) await completed.promise;
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
      await rm(root, { recursive: true, force: true });
    });
    const folder = join(root, 'fixture');
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, 'package.json'),
      JSON.stringify({
        name: 'qa-cancellable-pi',
        version: '1.0.0',
        scripts: { install: 'node stall.cjs' },
        pi: { extensions: ['./extension.js'] },
      }),
    );
    await writeFile(join(folder, 'extension.js'), 'export default function() {}');
    await writeFile(
      join(folder, 'stall.cjs'),
      `const fs=require('node:fs');fs.writeFileSync(process.env.PI_STUDIO_QA_INSTALL_MARKER,String(process.pid));setInterval(()=>fs.appendFileSync(${JSON.stringify(ticks)},'x'),10);`,
    );
    const npm = nodeTools().npm;
    assert.ok(npm);
    const packed = await promisify(execFile)(
      npm.command,
      [
        ...npm.args,
        'pack',
        folder,
        '--pack-destination',
        root,
        '--ignore-scripts',
        '--offline',
        '--json',
      ],
      { env: process.env, timeout: 20000 },
    );
    const archive = join(root, JSON.parse(packed.stdout)[0].filename),
      pi = await checkPi('');
    const service = new StudioService(join(root, 'prefs.json'), join(root, 'studio'));
    const store = await service.load();
    const native = new StudioResources(service, {
      piPath: () => pi.path,
      script: fileURLToPath(new URL('../bundled/pi-bridge/resources.mjs', import.meta.url)),
    });
    const admin = new SetupAdministration(
      service,
      async () => {
        throw Error('No model/network required');
      },
      native,
    );
    controller = new AbortController();
    const lease = await channel.add(
      'owned-install',
      {
        record: {},
        instructions: '',
        resources: { skills: [], plugins: [], mcpServers: [] },
      } as unknown as SessionEnvelope,
      async () => {},
      async (name, args, signal) => {
        started = true;
        try {
          return await admin.call(
            { projectRoot: join(store.folder, '.pistudio/setup-assistant') } as PreparedRun,
            name,
            args,
            signal,
          );
        } catch (error) {
          failure = error;
          throw error;
        } finally {
          completed.resolve();
        }
      },
      setupTools.filter((tool) => tool.name === 'install_package'),
    );
    const response = await fetch(lease.url + '/mcp', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + lease.token,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'install_package',
          arguments: { source: 'npm:qa-cancellable-pi@file:' + archive },
        },
      }),
      signal: controller.signal,
    });
    assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
    await until(async () => (await exists(marker)) && (await exists(ticks)), 20000);
    const pid = Number(await readFile(marker, 'utf8'));
    channel.remove('owned-install');
    await completed.promise;
    assert.equal((failure as Error)?.name, 'AbortError');
    await response.body?.cancel();
    await pause(80);
    const size = (await readFile(ticks, 'utf8')).length;
    await pause(80);
    assert.equal((await readFile(ticks, 'utf8')).length, size);
    assert.throws(() => process.kill(pid, 0));
    assert.deepEqual(store.bootstrap().sections.resources, []);
  },
);
