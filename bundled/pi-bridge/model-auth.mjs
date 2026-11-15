import { readFileSync, writeSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createConnectionRuntime } from './connection-runtime.mjs';
import { catalogData } from './catalog-data.mjs';
import { discoverEndpointModels } from './endpoint-runtime.mjs';
import { claudeStatus } from './claude-code/status.mjs';
try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  if (input.action === 'claude-status') {
    writeSync(3, JSON.stringify(await claudeStatus()));
    process.exit(0);
  }
  const sdk = await import(pathToFileURL(process.argv[2]).href);
  const runtime = await createConnectionRuntime(sdk, input.scope, input.cwd);
  let result;
  if (input.action === 'discover') result = await discoverEndpointModels(runtime, input.scope);
  else if (input.action === 'catalog')
    result = await catalogData(sdk, runtime, input.cwd, input.scope, process.argv[2]);
  else if (input.action === 'logout') {
    await runtime.logout(input.provider);
    result = { removed: true };
  } else if (input.action === 'status') {
    try {
      result =
        input.provider === 'claude-code'
          ? {
              provider: input.provider,
              ...(({ status, detail }) => ({ status, detail }))(await claudeStatus()),
            }
          : {
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
