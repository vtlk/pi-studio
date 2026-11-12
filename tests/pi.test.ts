import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { getProviderStatus, providerId, shellQuote } from '../src/main/pi/provider.ts';

test('provider IDs are validated and shell quoting preserves literal special characters', async () => {
  for (const value of ['', '../path', 'openai;whoami', '$(id)', '-arg', 'x\ny'])
    assert.throws(() => providerId(value));
  assert.equal(providerId('openai-codex'), 'openai-codex');
  const payload = "a'b $(printf BAD) `printf BAD` ; & < > \n quote";
  const { stdout } = await promisify(execFile)('/bin/sh', [
    '-c',
    `printf '%s' ${shellQuote(payload)}`,
  ]);
  assert.equal(stdout, payload);
});
test('Pi diagnostics execute argv without a shell, recognize capabilities and never expose auth material', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-pi-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "pi executable ' spaced");
  await writeFile(
    path,
    `#!/bin/sh
case "$1" in
  --version) printf '1.5.2\\n' ;;
  --help) printf 'pi mcp --session <path|id> --fork <path|id>\\n' ;;
  auth) printf '{"status":"not_ready","credential":"DO_NOT_RETURN"}'; exit 1 ;;
  *) exit 9 ;;
esac
`,
    { mode: 0o700 },
  );
  const diagnostics = await checkPi(path);
  assert.equal(diagnostics.supported, true);
  assert.equal(diagnostics.nativeMcp, true);
  assert.equal(diagnostics.exactSessions, true);
  const status = await getProviderStatus(path, 'openai-codex');
  assert.deepEqual(status, { provider: 'openai-codex', status: 'not_ready' });
  assert.equal(JSON.stringify(status).includes('DO_NOT_RETURN'), false);
  await assert.rejects(checkPi('relative/pi'));
});
