import { createInterface } from 'node:readline';
import { writeSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createConnectionRuntime } from './connection-runtime.mjs';
import { installOAuthPage } from './oauth-page.mjs';

// Native Pi owns OAuth/API-key setup, credential locking and refresh. No raw auth output is forwarded.
const send = (event) => writeSync(3, `${JSON.stringify(event)}\n`);
const controller = new AbortController(),
  answers = new Map();
let initialize;
const initialized = new Promise((resolve, reject) => {
  initialize = resolve;
  controller.signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true });
});
const input = createInterface({ input: process.stdin });
input.on('line', (line) => {
  try {
    if (line.length > 65536) throw new Error();
    const event = JSON.parse(line);
    if (event.type === 'init') {
      initialize?.(event);
      initialize = undefined;
    } else if (event.type === 'cancel') controller.abort();
    else if (event.type === 'answer' && typeof event.answer === 'string')
      answers.get(event.id)?.(event.answer);
  } catch {
    /* Transport data never becomes executable input. */
  }
});
input.on('close', () => controller.abort());
process.on('SIGTERM', () => controller.abort());
const deadline = setTimeout(() => controller.abort(), 5 * 60000);
try {
  const init = await initialized;
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(init.provider) ||
    !['oauth', 'api_key'].includes(init.method)
  )
    throw new Error('Invalid provider login');
  if (init.method === 'oauth') installOAuthPage(init.presentation);
  const sdk = await import(pathToFileURL(process.argv[2]).href);
  const runtime = await createConnectionRuntime(sdk, init.scope, init.cwd);
  await runtime.login(init.provider, init.method, {
    signal: controller.signal,
    notify(event) {
      if (event.type === 'auth_url') send({ type: 'auth_url', url: event.url });
      if (event.type === 'device_code')
        send({ type: 'auth_url', url: event.verificationUri, deviceCode: event.userCode });
    },
    async prompt(prompt) {
      const id = randomUUID();
      const signal = prompt.signal
        ? AbortSignal.any([controller.signal, prompt.signal])
        : controller.signal;
      if (signal.aborted) throw new Error('Cancelled');
      send({
        type: 'prompt',
        id,
        secret: prompt.type === 'secret',
        message: prompt.message,
        ...(prompt.type === 'select'
          ? { options: prompt.options.map((item) => ({ id: item.id, label: item.label })) }
          : {}),
      });
      return new Promise((resolve, reject) => {
        const abort = () => {
          answers.delete(id);
          reject(new Error('Cancelled'));
        };
        answers.set(id, (answer) => {
          answers.delete(id);
          signal.removeEventListener('abort', abort);
          if (prompt.type === 'select' && !prompt.options.some((item) => item.id === answer))
            reject(new Error('Invalid selection'));
          else resolve(answer);
        });
        signal.addEventListener('abort', abort, { once: true });
      });
    },
  });
  await runtime.settleCredentialWrites();
  send({ type: 'done' });
} catch {
  send({ type: controller.signal.aborted ? 'cancelled' : 'failed' });
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  input.close();
}
