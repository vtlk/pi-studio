import { changeLanguage } from '../src/shared/i18n/index.ts';
await changeLanguage('ru');
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ThemePreferences } from '../src/main/appearance/ThemePreferences.ts';
import { atomicJson } from '../src/main/storage/files.ts';
import { themeState } from '../src/shared/appearance.ts';

class NativeSource extends EventEmitter {
  source: 'system' | 'dark' | 'light' = 'system';
  systemDark = false;
  get shouldUseDarkColors() {
    return this.source === 'system' ? this.systemDark : this.source === 'dark';
  }
  get themeSource() {
    return this.source;
  }
  set themeSource(value: typeof this.source) {
    this.source = value;
    queueMicrotask(() => this.emit('updated'));
  }
  changeSystem(dark: boolean) {
    this.systemDark = dark;
    this.emit('updated');
  }
}
async function fixture(t: { after(fn: () => unknown): void }) {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-theme-unit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, file: join(root, 'appearance.json'), native: new NativeSource() };
}
test('fresh and legacy installations follow the OS without persisting an inferred choice', async (t) => {
  const f = await fixture(t);
  f.native.systemDark = true;
  const settings = await ThemePreferences.load(f.file, f.native);
  t.after(() => settings.close());
  assert.equal(settings.read().preference, 'system');
  assert.equal(settings.read().theme, 'dark');
  await assert.rejects(access(f.file), { code: 'ENOENT' });
  f.native.changeSystem(false);
  assert.equal(settings.read().theme, 'light');
  assert.equal(settings.read().preference, 'system');
  await assert.rejects(access(f.file), { code: 'ENOENT' });
});
test('explicit choice survives a new controller and ignores late system events', async (t) => {
  const f = await fixture(t);
  const first = await ThemePreferences.load(f.file, f.native);
  await first.set('dark');
  f.native.changeSystem(false);
  assert.equal(first.read().theme, 'dark');
  assert.deepEqual(JSON.parse(await readFile(f.file, 'utf8')), { theme: 'dark' });
  await first.close();
  const native = new NativeSource();
  const reopened = await ThemePreferences.load(f.file, native);
  t.after(() => reopened.close());
  assert.equal(native.themeSource, 'dark');
  assert.equal(reopened.read().theme, 'dark');
  native.changeSystem(false);
  assert.equal(reopened.read().theme, 'dark');
});
test('rapid choices serialize persistence; a late failed write cannot replace the latest choice/error', async (t) => {
  const f = await fixture(t);
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  let writes = 0;
  const settings = await ThemePreferences.load(f.file, f.native, async (file, value) => {
    if (++writes === 1) {
      await gate;
      throw Error('controlled write failure');
    }
    await atomicJson(file, value);
  });
  t.after(() => settings.close());
  const dark = settings.set('dark');
  await Promise.resolve();
  const light = settings.set('light');
  assert.equal(settings.read().theme, 'light');
  release();
  await Promise.all([dark, light]);
  assert.equal(settings.read().preference, 'light');
  assert.equal(settings.read().error, undefined);
  assert.deepEqual(JSON.parse(await readFile(f.file, 'utf8')), { theme: 'light' });
});
test('write failure keeps the chosen live theme, reports failure and preserves the saved preference', async (t) => {
  const f = await fixture(t);
  await atomicJson(f.file, { theme: 'light' });
  const settings = await ThemePreferences.load(f.file, f.native, async () => {
    throw Error('controlled failure');
  });
  t.after(() => settings.close());
  const result = await settings.set('dark');
  assert.equal(result.theme, 'dark');
  assert.match(result.error!, /не сохранён/);
  assert.deepEqual(JSON.parse(await readFile(f.file, 'utf8')), { theme: 'light' });
  const restarted = await ThemePreferences.load(f.file, new NativeSource());
  t.after(() => restarted.close());
  assert.equal(restarted.read().theme, 'light');
});
test('corrupt preference is a visible OS fallback; invalid IPC choices cannot change native settings or write', async (t) => {
  const f = await fixture(t);
  await writeFile(f.file, '{}');
  const settings = await ThemePreferences.load(f.file, f.native);
  t.after(() => settings.close());
  assert.match(settings.read().error!, /Не удалось прочитать/);
  for (const value of ['system', {}, null, 'Dark'])
    await assert.rejects(settings.set(value), /Выберите/);
  assert.equal(f.native.themeSource, 'system');
  assert.equal(await readFile(f.file, 'utf8'), '{}');
  assert.equal(themeState(settings.read()), true);
  assert.equal(themeState({ ...settings.read(), revision: NaN }), false);
});
