import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesTemplate } from '../src/renderer/features/settings/model/legacyTemplates.ts';
import { initialAgents } from '../src/renderer/fixtures/agents.ts';

test('legacy cleanup recognizes unchanged normalized templates but preserves every custom edit', () => {
  const template = initialAgents[0];
  const normalized = {
    ...template,
    model: Object.fromEntries(Object.entries(template.model!).reverse()),
  };
  assert.equal(matchesTemplate(normalized, template), true);
  assert.equal(matchesTemplate({ ...normalized, name: 'My agent' }, template), false);
  assert.equal(
    matchesTemplate({ ...normalized, mainInstruction: 'My instructions' }, template),
    false,
  );
  assert.equal(matchesTemplate({ ...normalized, enabled: false }, template), false);
  assert.equal(matchesTemplate({ ...normalized, skills: [] }, template), false);
  assert.equal(matchesTemplate({ ...normalized, id: 'custom' }, template), false);
  assert.equal(matchesTemplate(normalized, undefined), false);
});
