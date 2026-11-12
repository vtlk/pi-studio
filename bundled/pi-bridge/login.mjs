import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

// Pi owns OAuth, the callback server and credential storage. Only presentation events cross stdio.
const send = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const controller = new AbortController();
const answers = new Map();
const input = createInterface({ input: process.stdin });
input.on('line', (line) => {
  try {
    const event = JSON.parse(line);
    if (event.type === 'cancel') controller.abort();
    else if (event.type === 'answer' && typeof event.answer === 'string')
      answers.get(event.id)?.(event.answer);
  } catch {
    /* Invalid transport input never becomes a prompt or command. */
  }
});
input.on('close', () => controller.abort());
process.on('SIGTERM', () => controller.abort());
const deadline = setTimeout(() => controller.abort(), 5 * 60_000);
try {
  const { ModelRuntime } = await import(pathToFileURL(process.argv[2]).href);
  const runtime = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
  await runtime.login('openai-codex', 'oauth', {
    signal: controller.signal,
    notify(event) {
      if (event.type === 'auth_url') send({ type: 'auth_url', url: event.url });
      else if (event.type === 'error') send({ type: 'progress', phase: 'waiting' });
    },
    async prompt(prompt) {
      if (prompt.type === 'select') {
        if (!prompt.options?.[0]?.id) throw new Error('Unsupported sign-in method');
        return prompt.options[0].id;
      }
      const id = randomUUID();
      const signal = prompt.signal
        ? AbortSignal.any([controller.signal, prompt.signal])
        : controller.signal;
      if (signal.aborted) throw new Error('Cancelled');
      send({ type: 'prompt', id, secret: prompt.type === 'secret' });
      return new Promise((resolve, reject) => {
        const abort = () => {
          answers.delete(id);
          reject(new Error('Cancelled'));
        };
        answers.set(id, (answer) => {
          answers.delete(id);
          signal.removeEventListener('abort', abort);
          resolve(answer);
        });
        signal.addEventListener('abort', abort, { once: true });
      });
    },
  });
  await runtime.settleCredentialWrites();
  send({ type: 'done' });
} catch {
  // Errors may contain OAuth URLs or credentials. Keep them inside the native Pi process.
  send({ type: controller.signal.aborted ? 'cancelled' : 'failed' });
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  input.close();
}
