import assert from 'node:assert/strict';
import test from 'node:test';
import { parseReasoning, resolveReasoning, reasoningLabels } from '../src/shared/reasoning.ts';
import { hasModelConfiguration } from '../src/shared/modelConfiguration.ts';
import type { PiModelSummary } from '../src/shared/models.ts';

const model: PiModelSummary = {
  id: 'reasoning-model',
  provider: 'test',
  name: 'Reasoning',
  reasoning: true,
  imageInput: false,
  reasoningLevels: ['minimal', 'low', 'medium', 'high'],
  defaultReasoningLevel: 'medium',
};
test('native Pi levels and existing Russian selections resolve exactly; unknown is never medium', () => {
  for (const [level, label] of Object.entries(reasoningLabels)) {
    assert.equal(parseReasoning(level), level);
    assert.equal(parseReasoning(label), level);
  }
  assert.equal(resolveReasoning('low', model), 'low');
  assert.equal(resolveReasoning('Низкий', model), 'low');
  assert.equal(resolveReasoning('По умолчанию', model), 'medium');
  for (const value of ['typo', '', ' ', 'normal', 'LOW']) {
    assert.equal(parseReasoning(value), undefined);
    assert.throws(() => resolveReasoning(value, model), /корректный/);
    assert.equal(
      hasModelConfiguration({
        connectionId: 'test',
        provider: 'test',
        id: 'test',
        reasoning: value,
        temperature: '',
      }),
      false,
    );
  }
});
test('capabilities decide default and supported levels; explicit unsupported values never clamp', () => {
  for (const value of ['off', 'Максимальный', 'Предельный'])
    assert.throws(() => resolveReasoning(value, model), /не поддерживает/);
  const plain = {
    ...model,
    reasoning: false,
    reasoningLevels: ['off'] as const,
    defaultReasoningLevel: 'off' as const,
  };
  assert.equal(
    resolveReasoning('default', { ...plain, reasoningLevels: [...plain.reasoningLevels] }),
    'off',
  );
  assert.throws(
    () => resolveReasoning('Средний', { ...plain, reasoningLevels: [...plain.reasoningLevels] }),
    /не поддерживает/,
  );
  assert.throws(
    () => resolveReasoning('default', { ...model, reasoningLevels: undefined }),
    /Каталог/,
  );
  assert.throws(
    () => resolveReasoning('default', { ...model, defaultReasoningLevel: 'xhigh' }),
    /не поддерживает/,
  );
  assert.equal(
    resolveReasoning('max', { ...model, reasoningLevels: ['max'], defaultReasoningLevel: 'max' }),
    'max',
  );
});
