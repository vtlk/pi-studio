import assert from 'node:assert/strict';
import { BrowserAuth } from '../src/main/pi/BrowserAuth.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';

// Exercise the installed SDK transport, without opening a browser or submitting credentials.
let opened = false;
const auth = new BrowserAuth(
  new URL('../bundled/pi-bridge/login.mjs', import.meta.url).pathname,
  async (url) => {
    assert.equal(new URL(url).hostname, 'auth.openai.com');
    opened = true;
  },
);
try {
  const state = await auth.start((await checkPi('')).path);
  for (let i = 0; i < 150 && !opened; i++) {
    const next = auth.read(state.id);
    if (next.phase === 'error') throw new Error(next.message);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(opened, true, 'Native Pi OAuth must produce the browser URL');
  auth.cancel(state.id);
  assert.equal(auth.read(state.id).phase, 'cancelled');
  console.log(
    'Installed Pi SDK OAuth reached the official browser handoff; cancelled without credentials.',
  );
} finally {
  auth.close();
}
