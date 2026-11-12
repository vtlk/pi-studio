import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installPiRuntime } from '../src/main/pi/installRuntime.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';

// Opt-in real download/install: isolated from the user's existing Pi, credentials and projects.
const temporary = await mkdtemp(join(tmpdir(), 'pistudio-runtime-smoke-'));
let previous = '';
try {
  const pi = await installPiRuntime(
    join(temporary, 'pi'),
    new URL('../bundled/pi-runtime', import.meta.url).pathname,
    (state) => {
      if (state.message !== previous) console.log(state.message);
      previous = state.message;
    },
    AbortSignal.timeout(240_000),
  );
  const verified = await checkPi(pi.path);
  assert.equal(verified.supported && verified.nativeMcp && verified.exactSessions, true);
  console.log('Fresh private Pi installation passed; existing system Pi was unchanged.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
