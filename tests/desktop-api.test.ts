import { changeLanguage } from '../src/shared/i18n/index.ts';
await changeLanguage('en');
import assert from 'node:assert/strict';
import test from 'node:test';
import { getStudioApi } from '../src/renderer/shared/desktopApi.ts';

test('native access returns the exact preload bridge and reports a missing bridge explicitly', (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  Object.defineProperty(globalThis, 'window', { value: {}, configurable: true });
  assert.throws(getStudioApi, /native Pi Studio connection is unavailable/);
  const api = Object.freeze({ marker: 'isolated preload fixture' });
  Object.defineProperty(globalThis, 'window', { value: { studio: api }, configurable: true });
  assert.equal(getStudioApi(), api);
});
