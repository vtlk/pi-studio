import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Startup } from '../src/main/pi/Startup.ts';
import { PiNotFoundError } from '../src/main/pi/checkPi.ts';
import { validateRuntimeLock, installPiRuntime } from '../src/main/pi/installRuntime.ts';
import type { PiCheck } from '../src/shared/contracts.ts';

const ready: PiCheck = {
  path: '/existing/pi',
  version: '1.5.2',
  supported: true,
  nativeMcp: true,
  exactSessions: true,
};
async function settled(startup: Startup) {
  for (let i = 0; i < 100; i++) {
    const state = startup.read();
    if (['ready', 'error'].includes(state.phase)) return state;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error('Startup did not settle');
}
test('startup reuses an existing Pi and repeated reads never install it again', async () => {
  let probes = 0;
  const startup = new Startup({
    root: '/missing/pistudio-test-runtime',
    bundled: '',
    probe: async () => {
      probes++;
      return ready;
    },
    install: async () => {
      throw new Error('Unexpected install');
    },
  });
  assert.equal((await settled(startup)).phase, 'ready');
  startup.read();
  startup.retry();
  await settled(startup);
  assert.equal(probes, 2);
  assert.equal(startup.path, ready.path);
});
test('only a missing Pi triggers installation; broken and unsupported installs are preserved', async () => {
  let installs = 0;
  const install = async () => {
    installs++;
    return ready;
  };
  const options = { root: '/missing/pistudio-test-runtime', bundled: '', install };
  const missing = new Startup({
    ...options,
    probe: async () => {
      throw new PiNotFoundError('missing');
    },
  });
  assert.equal((await settled(missing)).phase, 'ready');
  for (const probe of [
    async () => {
      throw new Error('broken installation');
    },
    async () => ({ ...ready, supported: false }),
  ]) {
    assert.equal((await settled(new Startup({ ...options, probe }))).phase, 'error');
  }
  assert.equal(installs, 1);
});
test('mandatory startup has no skip; closing cancels installation and late completion cannot reopen the studio', async () => {
  let complete!: (value: PiCheck) => void;
  let signal!: AbortSignal;
  const startup = new Startup({
    root: '/missing/pistudio-test-runtime',
    bundled: '',
    probe: async () => {
      throw new PiNotFoundError();
    },
    install: async (_root, _bundled, _update, current) => {
      signal = current;
      return new Promise((resolve) => {
        complete = resolve;
      });
    },
  });
  startup.read();
  while (!complete) await new Promise((resolve) => setTimeout(resolve, 2));
  assert.equal('skip' in startup, false);
  startup.close();
  assert.equal(signal.aborted, true);
  complete(ready);
  await new Promise((resolve) => setTimeout(resolve, 2));
  assert.notEqual(startup.read().phase, 'ready');
  assert.equal(startup.path, '');
});
test('locked runtime rejects changed versions and unverified packages before filesystem changes', async (t) => {
  const manifest = JSON.parse(
    await readFile(new URL('../bundled/pi-runtime/package.json', import.meta.url), 'utf8'),
  );
  const lock = JSON.parse(
    await readFile(new URL('../bundled/pi-runtime/package-lock.json', import.meta.url), 'utf8'),
  );
  validateRuntimeLock(manifest, lock);
  assert.throws(() => validateRuntimeLock({ ...manifest, version: 'other' }, lock));
  const changed = structuredClone(lock);
  changed.packages['node_modules/@earendil-works/pi-coding-agent'].resolved =
    'https://example.com/pi.tgz';
  assert.throws(() => validateRuntimeLock(manifest, changed));
  const root = await mkdtemp(join(tmpdir(), 'pistudio-installer-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    installPiRuntime(
      join(root, 'pi'),
      new URL('../bundled/pi-runtime', import.meta.url).pathname,
      () => {},
      cancelled.signal,
    ),
  );
  assert.deepEqual(await readdir(root), []);
});
