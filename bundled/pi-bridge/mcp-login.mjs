import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

// Native Pi owns discovery, PKCE, loopback callback and OAuth tokens. Configuration travels only in stdin.
const send = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const controller = new AbortController();
const answers = new Map();
let initialize;
const initialized = new Promise((resolve, reject) => {
  initialize = resolve;
  controller.signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true });
});
const input = createInterface({ input: process.stdin });
input.on('line', (line) => {
  try {
    if (line.length > 100000) throw new Error();
    const event = JSON.parse(line);
    if (event.type === 'init' && initialize) {
      initialize(event);
      initialize = undefined;
    } else if (event.type === 'cancel') controller.abort();
    else if (event.type === 'answer' && typeof event.answer === 'string')
      answers.get(event.id)?.(event.answer);
  } catch {
    controller.abort();
  }
});
input.on('close', () => controller.abort());
process.once('SIGTERM', () => controller.abort());
let connection;
controller.signal.addEventListener('abort', () => {
  void connection?.close();
});
const deadline = setTimeout(() => controller.abort(), 5 * 60_000);
try {
  const request = await initialized;
  const sdk = pathToFileURL(process.argv[2]);
  const core = await import(new URL('./core/mcp-servers.js', sdk).href);
  const { McpServerConnection, McpOAuthCredentialStore, createDefaultTransport, signInMcpServer } =
    await import(new URL('./extensions/mcp/runtime.js', sdk).href);
  if (typeof request.name !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(request.name)) throw new Error();
  const config = core.validateMcpServerConfig(request.name, request.config);
  if (typeof config === 'string' || !config.url || config.enabled === false) throw new Error();
  const credentials = new McpOAuthCredentialStore();
  connection = new McpServerConnection({
    entry: { name: request.name, config, source: 'Pi Studio OAuth', scope: 'extension' },
    cwd: process.cwd(),
    credentials,
    createTransport: createDefaultTransport,
    onTools: () => {},
  });
  try {
    await connection.getClient();
  } catch {
    if (connection.state !== 'needs-auth') throw new Error();
  }
  if (connection.state === 'needs-auth') {
    if (!connection.oauthUrl) throw new Error();
    await signInMcpServer({
      serverUrl: config.url,
      store: credentials.forServer(request.name, config.url),
      settings: connection.oauthSettings(),
      challenge: connection.challenge,
      signal: controller.signal,
      prompt: {
        showAuthorizationUrl: (url) => send({ type: 'auth_url', url: url.href }),
        promptForRedirectUrl: (signal) => {
          if (signal.aborted || controller.signal.aborted) return Promise.resolve(undefined);
          const id = randomUUID();
          send({ type: 'prompt', id, secret: true });
          return new Promise((resolve) => {
            const abort = () => {
              answers.delete(id);
              resolve(undefined);
            };
            signal.addEventListener('abort', abort, { once: true });
            answers.set(id, (answer) => {
              answers.delete(id);
              signal.removeEventListener('abort', abort);
              resolve(answer);
            });
          });
        },
      },
    });
    connection.challenge = undefined;
    await connection.reconnect();
  }
  if (controller.signal.aborted) throw new Error();
  send({ type: 'done' });
} catch {
  send({ type: controller.signal.aborted ? 'cancelled' : 'failed' });
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await connection?.close();
  input.close();
}
