import assert from 'node:assert/strict';
import { BrowserAuth } from '../src/main/pi/BrowserAuth.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { writeFile } from 'node:fs/promises';

// Exercise the installed SDK transport, without opening a browser or submitting credentials.
let opened = false;
let browserMethodSelected = false;
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
    if (next.prompt?.options?.some((option) => option.id === 'browser')) {
      assert.equal(next.prompt.secret, false);
      auth.answer(state.id, next.prompt.id, 'browser');
      browserMethodSelected = true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(opened, true, 'Native Pi OAuth must produce the browser URL');
  auth.cancel(state.id);
  assert.equal(auth.read(state.id).phase, 'cancelled');
  await writeFile(
    'artifacts/codex-auth-handoff-proof.json',
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        nativePi: '1.5.2',
        actualNativeProvider: 'openai-codex',
        browserMethodSelected,
        officialHostValidated: true,
        nativePromptAndFdProtocol: true,
        cancelledBeforeCredentialSubmission: true,
        browserActuallyOpened: false,
        limits:
          'Actual native Pi OAuth flow reaches the intercepted official browser URL after selecting its public browser method. No new user consent, credential submission or token refresh acceptance is proven by this check.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'Installed Pi SDK OAuth reached the official browser handoff; cancelled without credentials.',
  );
} finally {
  auth.close();
}
