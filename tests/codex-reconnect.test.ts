import test from 'node:test';
import assert from 'node:assert/strict';
import { registerCodexReconnect } from '../bundled/pi-bridge/codex-reconnect.mjs';

test('Codex reconnect extends native retry only for transport failures and restores the normal policy', () => {
  const normal = { maxRetries: 3, maxAgentDelayMs: 60_000 };
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const overrides: { retry: typeof normal }[] = [];
  const statuses: (string | undefined)[] = [];
  let enabled = true;
  const ctx = {
    ui: { setStatus: (_key: string, status?: string) => statuses.push(status) },
  };
  registerCodexReconnect(
    { on: (name: string, handler: (...args: unknown[]) => void) => handlers.set(name, handler) },
    {
      getRetrySettings: () => normal,
      getRetryEnabled: () => enabled,
      applyOverrides: (change: { retry: typeof normal }) => overrides.push(change),
    },
    () => 'ru',
  );
  const settled = () => handlers.get('agent_settled')!({}, ctx);
  const end = (errorMessage?: string, provider = 'openai-codex') =>
    handlers.get('agent_end')!(
      {
        messages: [
          {
            role: 'assistant',
            provider,
            stopReason: errorMessage ? 'error' : 'stop',
            errorMessage,
          },
        ],
      },
      ctx,
    );
  const timeout = 'fetch failed: Connect Timeout Error (UND_ERR_CONNECT_TIMEOUT)';
  const brokenPipe = 'fetch failed: write EPIPE';
  for (const error of [
    'HTTP 429: too many requests',
    'HTTP 401: unauthorized',
    'The usage limit has been reached',
    'Unsupported model',
    'write EPIPE',
    'HTTP 429: write EPIPE',
  ])
    end(error);
  end(timeout, 'openai');
  end(brokenPipe, 'openai');
  assert.deepEqual(overrides, []);

  end(brokenPipe);
  end(timeout);
  assert.deepEqual(overrides, [{ retry: { maxRetries: 24, maxAgentDelayMs: 30_000 } }]);
  assert.match(statuses[0] ?? '', /Восстанавливаем связь/);
  end('HTTP 429: too many requests');
  assert.deepEqual(overrides.at(-1), { retry: normal });
  assert.equal(statuses.at(-1), undefined);

  end(timeout);
  settled();
  assert.deepEqual(overrides.at(-1), { retry: normal });
  enabled = false;
  end(timeout);
  assert.equal(overrides.length, 4);
});
