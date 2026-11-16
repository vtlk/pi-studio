import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesLegacyTemplate } from '../src/renderer/features/settings/model/legacyTemplates.ts';
import { initialAgents } from '../src/renderer/fixtures/agents.ts';
import { exampleConnections } from '../src/renderer/fixtures/connections.ts';
import { exampleResources } from '../src/renderer/fixtures/resources.ts';
import { normalizeBuiltinAssignments } from '../src/shared/builtinAssignments.ts';

test('required Project migration preserves exact legacy matching and never hides custom changes', async () => {
  for (const template of initialAgents) {
    const migrated = normalizeBuiltinAssignments(template);
    assert.equal(await matchesLegacyTemplate(migrated, 'agents'), true);
    assert.equal(await matchesLegacyTemplate({ ...migrated, mainInstruction: 'User instructions' }, 'agents'), false);
    assert.equal(await matchesLegacyTemplate({ ...migrated, mcps: [...migrated.mcps, 'custom'] }, 'agents'), false);
  }
});

test('legacy cleanup recognizes unchanged normalized templates but preserves every custom edit', async () => {
  const template = initialAgents[0];
  const normalized = {
    ...template,
    model: Object.fromEntries(Object.entries(template.model!).reverse()),
  };
  assert.equal(await matchesLegacyTemplate(normalized, 'agents'), true);
  assert.equal(await matchesLegacyTemplate({ ...normalized, name: 'My agent' }, 'agents'), false);
  assert.equal(
    await matchesLegacyTemplate({ ...normalized, mainInstruction: 'My instructions' }, 'agents'),
    false,
  );
  assert.equal(await matchesLegacyTemplate({ ...normalized, enabled: false }, 'agents'), false);
  assert.equal(await matchesLegacyTemplate({ ...normalized, skills: [] }, 'agents'), false);
  assert.equal(await matchesLegacyTemplate({ ...normalized, id: 'custom' }, 'agents'), false);
  assert.equal(await matchesLegacyTemplate(normalized, 'resources'), false);
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
