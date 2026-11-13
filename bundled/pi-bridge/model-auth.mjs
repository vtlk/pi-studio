import { readFileSync, writeSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createConnectionRuntime } from './connection-runtime.mjs';
import { catalogData } from './catalog-data.mjs';
try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const sdk = await import(pathToFileURL(process.argv[2]).href);
  const runtime = await createConnectionRuntime(sdk, input.scope);
  let result;
  if (input.action === 'catalog') result = await catalogData(sdk, runtime, input.cwd);
  else if (input.action === 'logout') {
    await runtime.logout(input.provider);
    result = { removed: true };
  } else if (input.action === 'status') {
    try {
      result = {
        provider: input.provider,
        status: (await runtime.checkAuth(input.provider)) ? 'ready' : 'not_ready',
      };
    } catch {
      result = { provider: input.provider, status: 'invalid' };
    }
  } else throw new Error('Unsupported operation');
  await runtime.settleCredentialWrites();
  writeSync(3, JSON.stringify(result));
} catch {
  // Never forward SDK auth errors, tokens, command output or provider responses.
  process.exitCode = 1;
}
