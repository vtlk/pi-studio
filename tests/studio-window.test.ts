import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Module from 'node:module';
import { EventEmitter } from 'node:events';
import ts from 'typescript';

test('activation opens/reuses the Studio window even while a hidden rendering window exists', async () => {
  class FakeWindow extends EventEmitter {
    static windows: FakeWindow[] = [];
    static getAllWindows() {
      return FakeWindow.windows;
    }
    shown = 0;
    destroyed = false;
    webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler() {} });
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
  const originalLoad = Module._load;
  Module._load = function (id: string, ...rest: unknown[]) {
    if (id === 'electron')
      return {
        BrowserWindow: FakeWindow,
        nativeTheme: { shouldUseDarkColors: false },
        session: { defaultSession: { setPermissionRequestHandler() {} } },
        dialog: {},
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
  assert.equal(background.shown, 0);
  assert.ok(first.options.webPreferences.preload.endsWith('preload/index.cjs'));
  assert.equal(instance.exports.createStudioWindow(), first);
  assert.equal(first.shown, 1);
  first.destroyed = true;
  assert.notEqual(instance.exports.createStudioWindow(), first);
  assert.equal(background.shown, 0);
});
