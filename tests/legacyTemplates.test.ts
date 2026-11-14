import assert from 'node:assert/strict';
import test from 'node:test';
import {
  matchesTemplate,
  matchesLegacyTemplate,
} from '../src/renderer/features/settings/model/legacyTemplates.ts';
import { initialAgents } from '../src/renderer/fixtures/agents.ts';
import { exampleConnections } from '../src/renderer/fixtures/connections.ts';
import { exampleResources } from '../src/renderer/fixtures/resources.ts';

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

test('native hashes recognize every historical template without bundling its text and preserve custom data', async () => {
  for (const [section, templates] of [
    ['agents', initialAgents],
    ['connections', exampleConnections],
    ['resources', exampleResources],
  ] as const) {
    for (const template of templates) {
      assert.equal(await matchesLegacyTemplate(template, section), true);
      assert.equal(
        await matchesLegacyTemplate(
          Object.fromEntries(Object.entries(template).reverse()) as typeof template,
          section,
        ),
        true,
      );
      assert.equal(
        await matchesLegacyTemplate({ ...template, name: 'Custom name' }, section),
        false,
      );
      assert.equal(await matchesLegacyTemplate({ ...template, id: 'custom-id' }, section), false);
    }
  }
  const agent = initialAgents[0];
  for (const change of [
    { enabled: !agent.enabled },
    { mainInstruction: 'User role' },
    { model: { ...agent.model, reasoning: 'User effort' } },
    { instructions: [...agent.instructions].reverse() },
    { skills: [] },
  ])
    assert.equal(await matchesLegacyTemplate({ ...agent, ...change }, 'agents'), false);
});
