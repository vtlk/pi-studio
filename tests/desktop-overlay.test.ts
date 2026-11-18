import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import ts from 'typescript';
import { yellowCursorScript } from '../bundled/pi-bridge/browser/yellowCursor.mjs';

for (const platform of ['darwin', 'win32']) {
  test(`${platform}: actual ComputerOverlay keeps frame/pointer five seconds, resets on a new call and releases exact session`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const windows: any[] = [];
    const display = {
      id: 1,
      bounds: { x: 0, y: 0, width: 1000, height: 800 },
      workArea: { y: 20 },
    };
    class Window extends EventEmitter {
      destroyed = false;
      visible = false;
      state: any;
      options: any;
      webContents = {
        setWindowOpenHandler() {},
        on() {},
        session: { setPermissionRequestHandler() {} },
        executeJavaScript: async (script: string) => {
          this.state = JSON.parse(script.slice(script.indexOf('detail:') + 7, -3));
        },
      };
      constructor(options: any) {
        super();
        this.options = options;
        windows.push(this);
      }
      setIgnoreMouseEvents() {}
      setAlwaysOnTop() {}
      setVisibleOnAllWorkspaces() {}
      loadFile() {
        return Promise.resolve();
      }
      loadURL() {
        return Promise.resolve();
      }
      getContentBounds() {
        return display.bounds;
      }
      setContentBounds() {}
      isDestroyed() {
        return this.destroyed;
      }
      isVisible() {
        return this.visible;
      }
      showInactive() {
        this.visible = true;
      }
      hide() {
        this.visible = false;
      }
      destroy() {
        this.destroyed = true;
        this.emit('closed');
      }
    }
    const source = ts.transpileModule(
      readFileSync('src/main/computer/ComputerOverlay.ts', 'utf8'),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
    ).outputText;
    const exports: any = {};
    runInNewContext(source, {
      exports,
      __dirname: '.',
      process: { platform, env: {} },
      setTimeout,
      clearTimeout,
      require(name: string) {
        if (name === 'electron')
          return {
            BrowserWindow: Window,
            screen: Object.assign(new EventEmitter(), {
              getAllDisplays: () => [display],
              screenToDipPoint: ({ x, y }: any) => ({ x: x / 2, y: y / 2 }),
            }),
          };
        if (name === 'node:path') return { join: (...a: string[]) => a.join('/') };
        if (name.includes('i18n'))
          return { i18n: Object.assign(new EventEmitter(), { resolvedLanguage: 'en' }) };
        if (name.includes('ComputerFeedback'))
          return { computerAgentLabel: (name: string) => name };
        return { computerFeedbackEvent: 'feedback' };
      },
    });
    const overlay = new exports.ComputerOverlay();
    await overlay.begin('a', 'Agent', 'click');
    await overlay.pointer('a', { x: 200, y: 100 }, true);
    assert.equal(windows[0].visible, true);
    assert.equal(windows[0].options.focusable, false);
    assert.equal(windows[0].state.point.x, platform === 'win32' ? 100 : 200);
    overlay.finish('a');
    t.mock.timers.tick(4999);
    assert.equal(windows[0].destroyed, false);
    await overlay.begin('a', 'Agent', 'read');
    assert.equal(windows[0].state.point.x, platform === 'win32' ? 100 : 200);
    overlay.finish('a');
    t.mock.timers.tick(4999);
    assert.equal(windows[0].visible, true);
    overlay.release('other');
    assert.equal(windows[0].destroyed, false);
    t.mock.timers.tick(1);
    assert.equal(windows[0].destroyed, true);
    overlay.close();
  });
}

test('visible browser frame and yellow cursor persist across calls, expire five seconds after completion, never expire mid-tool', () => {
  const timers = new Map<number, () => void>();
  let next = 0;
  const pointer = { style: {} };
  const shadow = { innerHTML: '', querySelector: () => pointer, prepend() {} };
  const host = {
    isConnected: true,
    style: { cssText: '', visibility: '' },
    setAttribute() {},
    attachShadow: () => shadow,
    remove() {
      this.isConnected = false;
    },
  };
  const context: any = {
    document: { documentElement: { append() {} }, createElement: () => host },
    setTimeout(fn: () => void, ms: number) {
      assert.ok(ms === 5000 || ms === 700);
      timers.set(++next, fn);
      return next;
    },
    clearTimeout(id: number) {
      timers.delete(id);
    },
  };
  runInNewContext(yellowCursorScript({ x: 42, y: 19 }, false, true, true), context);
  assert.match(shadow.innerHTML, /class="edge"/);
  assert.match(shadow.innerHTML, /fill="#f2cc43"/);
  assert.equal((pointer.style as any).left, '42px');
  assert.equal(timers.size, 0, 'Busy tool has no idle deadline');
  runInNewContext(yellowCursorScript(undefined, false, true, false), context);
  assert.equal(timers.size, 1);
  runInNewContext(yellowCursorScript(undefined, false, true, true), context);
  assert.equal(timers.size, 0, 'Next tool cancels previous timeout');
  runInNewContext(yellowCursorScript(undefined, false, true, false), context);
  [...timers.values()][0]();
  assert.equal(host.style.visibility, 'hidden');
  runInNewContext(yellowCursorScript(undefined, false, false), context);
  assert.equal(host.isConnected, false);
});
