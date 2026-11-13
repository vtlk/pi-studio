import assert from 'node:assert/strict';
import test from 'node:test';
import { hasModelConfiguration } from '../src/shared/modelConfiguration.ts';

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
