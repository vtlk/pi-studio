import assert from 'node:assert/strict';
import test from 'node:test';
import { hasModelConfiguration, validateAgentModel } from '../src/shared/modelConfiguration.ts';
import type { Connection } from '../src/shared/connections.ts';

test('launch configuration requires a model, an explicit connection/provider and a reasoning setting', () => {
  const model = {
    connectionId: 'account',
    provider: 'openai-codex',
    id: 'model',
    reasoning: 'Средний',
    temperature: '',
  };
  assert.equal(hasModelConfiguration(model), true);
  assert.equal(hasModelConfiguration(undefined), false);
  for (const field of ['connectionId', 'provider', 'id', 'reasoning'])
    for (const value of ['', '  '])
      assert.equal(hasModelConfiguration({ ...model, [field]: value }), false);
  assert.equal(hasModelConfiguration({ ...model, reasoning: 'По умолчанию' }), true);
});

test('agent selection rejects missing accounts, Images API and mismatched providers without fallback', () => {
  const model = {
    connectionId: 'account',
    provider: 'p',
    id: 'm',
    reasoning: 'Низкий',
    temperature: '',
  };
  const connection: Connection = {
    id: 'account',
    providerId: 'p',
    purpose: 'pi',
    name: 'Account',
    endpoint: '',
    account: '',
    createdAt: 1,
  };
  assert.deepEqual(validateAgentModel(model, [connection]), { ok: true, model, connection });
  assert.deepEqual(validateAgentModel(undefined, [connection]), {
    ok: false,
    reason: 'missing-model',
  });
  assert.deepEqual(validateAgentModel({ ...model, reasoning: ' ' }, [connection]), {
    ok: false,
    reason: 'missing-model',
  });
  assert.deepEqual(validateAgentModel(model, [{ ...connection, id: 'other' }]), {
    ok: false,
    reason: 'missing-connection',
  });
  assert.deepEqual(validateAgentModel(model, [{ ...connection, purpose: 'images' }]), {
    ok: false,
    reason: 'images-connection',
  });
  assert.deepEqual(validateAgentModel(model, [{ ...connection, providerId: 'other' }]), {
    ok: false,
    reason: 'provider-mismatch',
  });
});
