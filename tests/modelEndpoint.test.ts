import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  modelEndpointUrl,
  parseModelEndpoint,
  endpointProviderId,
} from '../src/shared/modelEndpoint.ts';
import { parseSection } from '../src/main/storage/validation.ts';
import { connectionAuthScope } from '../src/main/pi/modelAuth.ts';
import type { Connection } from '../src/shared/connections.ts';

const config = {
  api: 'openai-completions' as const,
  auth: 'api_key' as const,
  models: [
    {
      id: 'test',
      name: 'Test',
      imageInput: false,
      reasoning: false,
      contextWindow: 4096,
      maxTokens: 1024,
    },
  ],
};
test('endpoint URLs and explicit capabilities reject ambiguous or unsafe persisted data', () => {
  assert.equal(modelEndpointUrl('http://localhost:1234/v1/'), 'http://localhost:1234/v1');
  for (const url of [
    'file:///tmp/api',
    'javascript:alert(1)',
    'https://user:key@example.com',
    'https://example.com?key=secret',
    'https://example.com/#key',
  ])
    assert.throws(() => modelEndpointUrl(url));
  for (const data of [
    { ...config, api: 'unknown' },
    { ...config, auth: 'ambient' },
    { ...config, models: [{ ...config.models[0], imageInput: undefined }] },
    { ...config, models: [{ ...config.models[0], maxTokens: 10000 }] },
    { ...config, models: [config.models[0], config.models[0]] },
  ])
    assert.throws(() => parseModelEndpoint(data));
  assert.deepEqual(parseModelEndpoint(config), config);
  const saved = parseSection('connections', [
    {
      id: 'custom',
      name: 'Server',
      purpose: 'local',
      providerId: 'studio-custom',
      authScope: 'connection',
      endpoint: 'http://localhost:1234/v1/',
      endpointConfig: config,
      account: '',
      createdAt: 1,
    },
  ]) as Connection[];
  assert.equal(saved[0].endpoint, 'http://localhost:1234/v1');
  assert.deepEqual(saved[0].endpointConfig, config);
});
test('custom auth namespaces bind the destination/protocol/auth mode, retaining keys when only model metadata changes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-endpoint-scope-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const connection: Connection = {
    id: 'custom',
    name: 'Server',
    purpose: 'compatible',
    providerId: endpointProviderId('custom'),
    endpoint: 'http://localhost:1234/v1',
    authScope: 'connection',
    endpointConfig: config,
    account: '',
    createdAt: 1,
  };
  const path = async (value: Connection) =>
    (await connectionAuthScope(join(root, 'auth'), root, value))!.authPath;
  const before = await path(connection);
  assert.equal(
    await path({
      ...connection,
      name: 'Renamed',
      endpointConfig: { ...config, models: [{ ...config.models[0], imageInput: true }] },
    }),
    before,
  );
  assert.notEqual(await path({ ...connection, endpoint: 'http://localhost:9876/v1' }), before);
  assert.notEqual(
    await path({ ...connection, endpointConfig: { ...config, api: 'openai-responses' } }),
    before,
  );
  assert.notEqual(
    await path({ ...connection, endpointConfig: { ...config, auth: 'none' } }),
    before,
  );
  await assert.rejects(() => path({ ...connection, providerId: 'openai' }), /Пересохраните/);
});
