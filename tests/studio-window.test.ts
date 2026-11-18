import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Module from 'node:module';
import { EventEmitter } from 'node:events';
import ts from 'typescript';

test('activation opens/reuses the Studio window even while a hidden rendering window exists', async (t) => {
  const data = await mkdtemp(join(tmpdir(), 'pistudio-window-recovery-'));
  t.after(() => rm(data, { recursive: true, force: true }));
  let recoveryDialogs = 0;
  let permissionCheck: (...args: any[]) => boolean;
  let permissionRequest: (...args: any[]) => void;
  let beforeRequest: (...args: any[]) => void;
  class FakeWindow extends EventEmitter {
    static windows: FakeWindow[] = [];
    static getAllWindows() {
      return FakeWindow.windows;
    }
    shown = 0;
    destroyed = false;
    loads = 0;
    webContents = Object.assign(new EventEmitter(), {
      id: FakeWindow.windows.length + 1,
      setWindowOpenHandler() {},
      isDestroyed: () => this.destroyed,
    });
    readonly options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      super();
      this.options = options;
      FakeWindow.windows.push(this);
    }
    isDestroyed() {
      return this.destroyed;
    }
    show() {
      this.shown++;
    }
    loadFile() {
      this.loads++;
      return Promise.resolve();
    }
    loadURL() {
      return Promise.resolve();
    }
  }
  const background = new FakeWindow({ show: false });
  const filename = fileURLToPath(
    new URL('../src/main/windows/createStudioWindow.ts', import.meta.url),
  );
  const compiled = ts.transpileModule(await readFile(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const instance = new Module(filename);
  instance.filename = filename;
  const originalLoad = Module._load;
  Module._load = function (id: string, ...rest: unknown[]) {
    if (id === 'electron')
      return {
        BrowserWindow: FakeWindow,
        nativeTheme: { shouldUseDarkColors: false },
        session: {
          defaultSession: {
            setPermissionRequestHandler(handler: typeof permissionRequest) {
              permissionRequest = handler;
            },
            setPermissionCheckHandler(handler: typeof permissionCheck) {
              permissionCheck = handler;
            },
            webRequest: {
              onBeforeRequest(handler: typeof beforeRequest) {
                beforeRequest = handler;
              },
            },
          },
        },
        app: { getPath: () => data },
        dialog: {
          showMessageBoxSync: () => 0,
          showMessageBox: async () => {
            recoveryDialogs++;
            return { response: 1 };
          },
        },
        shell: {},
      };
    return originalLoad.call(this, id, ...rest);
  };
  try {
    instance._compile(compiled, filename);
  } finally {
    Module._load = originalLoad;
  }
  const first = instance.exports.createStudioWindow();
  assert.notEqual(first, background);
  const contents = first.webContents;
  assert.equal(
    permissionCheck!(contents, 'media', '', { isMainFrame: true, mediaType: 'audio' }),
    true,
  );
  assert.equal(
    permissionCheck!(contents, 'media', '', { isMainFrame: false, mediaType: 'audio' }),
    false,
  );
  assert.equal(
    permissionCheck!(contents, 'media', '', { isMainFrame: true, mediaType: 'video' }),
    false,
  );
  assert.equal(
    permissionCheck!(background.webContents, 'media', '', {
      isMainFrame: true,
      mediaType: 'audio',
    }),
    false,
  );
  const requested = (details: unknown) => {
    let granted;
    permissionRequest!(
      contents,
      'media',
      (value: boolean) => {
        granted = value;
      },
      details,
    );
    return granted;
  };
  assert.equal(requested({ isMainFrame: true, mediaTypes: ['audio'] }), true);
  assert.equal(requested({ isMainFrame: false, mediaTypes: ['audio'] }), false);
  assert.equal(requested({ isMainFrame: true, mediaTypes: ['audio', 'video'] }), false);
  const cancelled = (details: unknown) => {
    let result;
    beforeRequest!(details, (value: unknown) => {
      result = value;
    });
    return result;
  };
  assert.deepEqual(
    cancelled({ webContentsId: contents.id, resourceType: 'script', frame: { parent: {} } }),
    { cancel: true },
  );
  assert.deepEqual(cancelled({ webContentsId: contents.id, resourceType: 'subFrame' }), {
    cancel: true,
  });
  assert.deepEqual(
    cancelled({ webContentsId: contents.id, resourceType: 'script', frame: { parent: null } }),
    { cancel: false },
  );
  let blocked = false;
  contents.emit('will-frame-navigate', {
    isMainFrame: false,
    url: 'file:///private',
    preventDefault() {
      blocked = true;
    },
  });
  assert.equal(blocked, true);

  assert.equal(background.shown, 0);
  assert.ok(first.options.webPreferences.preload.endsWith('preload/index.cjs'));
  assert.equal(instance.exports.createStudioWindow(), first);
  assert.equal(first.shown, 1);
  first.emit('close');
  first.webContents.emit('render-process-gone', {}, { reason: 'clean-exit', exitCode: 0 });
  await new Promise((done) => setImmediate(done));
  assert.equal(first.loads, 1, 'intentional closing does not reload');
  let discarded = false;
  first.webContents.emit('will-prevent-unload', {
    preventDefault: () => {
      discarded = true;
    },
  });
  assert.equal(discarded, false, 'Stay keeps pending edits');
  first.webContents.emit(
    'render-process-gone',
    {},
    { reason: 'killed', exitCode: 9, notAllowed: 'private-fixture-value' },
  );
  await new Promise((done) => setImmediate(done));
  assert.equal(first.loads, 2);
  assert.equal(FakeWindow.windows.length, 2, 'recovery reuses the same window');
  assert.equal(recoveryDialogs, 0);
  let diagnostic;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      diagnostic = JSON.parse(await readFile(join(data, 'renderer-failure.json'), 'utf8'));
      break;
    } catch {
      await new Promise((done) => setTimeout(done, 10));
    }
  }
  assert.equal(diagnostic.reason, 'killed');
  assert.equal(diagnostic.exitCode, 9);
  assert.deepEqual(Object.keys(diagnostic).sort(), ['at', 'exitCode', 'reason']);
  first.destroyed = true;
  assert.notEqual(instance.exports.createStudioWindow(), first);
  assert.equal(background.shown, 0);
});
