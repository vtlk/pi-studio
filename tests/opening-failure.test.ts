import test from 'node:test';
import assert from 'node:assert/strict';
import { openingFailure, openingFailureText } from '../src/shared/openingFailure.ts';
import { RunLifecycle } from '../src/main/pi/RunLifecycle.ts';
import {
  StudioOpeningError,
  openingFailure as bridgeFailure,
  openingFailureText as bridgeText,
} from '../bundled/pi-bridge/opening-failure.mjs';
import { waitForMcp } from '../bundled/pi-bridge/mcp-health.mjs';
import { studioMcpDeadlines } from '../bundled/pi-bridge/mcp-deadlines.mjs';

test('opening diagnostics report controlled stage/MCP names without forwarding upstream secrets', async () => {
  const upstream = new Error('Authorization: Bearer SECRET_PROVIDER_TOKEN');
  const issue = bridgeFailure(upstream, 'terminal');
  assert.deepEqual(openingFailure(issue), { kind: 'terminal' });
  assert.equal(bridgeText(issue), openingFailureText(issue));
  assert.equal(bridgeText(issue).includes('SECRET_PROVIDER_TOKEN'), false);
  const unknownMcp = bridgeFailure(upstream, 'mcp');
  assert.deepEqual(openingFailure(unknownMcp), { kind: 'resources' });
  assert.equal(bridgeText(unknownMcp).includes('SECRET_PROVIDER_TOKEN'), false);
  for (const value of [
    { kind: 'anything', message: upstream.message },
    { kind: 'mcp', servers: ['unsafe secret/url'] },
    { kind: '__proto__' },
  ])
    assert.equal(openingFailure(value), undefined);
  for (const status of ['error', 'closed', 'connecting']) {
    let caught;
    try {
      await waitForMcp(new Map([['voice_server', status]]), ['voice_server'], 1);
    } catch (error) {
      caught = error;
    }
    assert.ok(caught instanceof StudioOpeningError);
    const mcp = bridgeFailure(caught, 'resources');
    assert.deepEqual(openingFailure(mcp), { kind: 'mcp', servers: ['voice_server'] });
    assert.equal(bridgeText(mcp), openingFailureText(mcp));
  }
});
test('launch failure reaches the caller with the named MCP rather than a nonexistent Terminal detail', async () => {
  let failure: Error | undefined;
  const lifecycle = new RunLifecycle({ update: async () => ({}), read: async () => ({}) } as never);
  const live = {
    run: {},
    status: 'waiting',
    fail: (error: Error) => {
      failure = error;
    },
  };
  await lifecycle.event(live as never, {
    type: 'error',
    openingIssue: { kind: 'mcp', servers: ['elevenlabs'] },
  });
  assert.match(failure!.message, /Не подключены MCP: elevenlabs/);
  assert.equal(failure!.message.includes('Подробности доступны'), false);
});
test('unlimited native client deadline is confined to the authenticated app-owned team entry', () => {
  const bootstrap = { url: 'http://127.0.0.1:123/session/owned', token: 'probe-token' };
  const owned = {
    name: 'team',
    source: 'Pi Studio system',
    config: {
      url: bootstrap.url + '/mcp/team',
      headers: { Authorization: 'Bearer probe-token' },
      timeout: 120,
    },
  };
  const external = { ...owned, source: 'External assignment' };
  const other = { ...owned, name: 'pi_studio_computer' };
  const wrong = { ...owned, config: { ...owned.config, url: 'https://external.invalid/mcp' } };
  const result = studioMcpDeadlines([owned, external, other, wrong], bootstrap);
  assert.equal(result[0].config.timeout, Infinity);
  assert.equal(owned.config.timeout, 120, 'Input envelope/JSON config is unchanged');
  assert.deepEqual(result.slice(1), [external, other, wrong]);
});
