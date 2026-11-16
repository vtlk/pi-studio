import test from 'node:test';
import assert from 'node:assert/strict';
import {
  retireLegacyFeatures,
  withoutRetiredResources,
  retiredBuiltin,
} from '../src/main/storage/retireLegacyFeatures.ts';
import { parseStudio } from '../src/main/storage/validation.ts';
import { createSystemAgents } from '../src/shared/systemAgents.ts';
import type { Agent } from '../src/shared/studio.ts';
const obsolete = 'pistudio-library';
const profile = (id: string): Agent => ({
  id,
  name: 'User ' + id,
  enabled: true,
  instructions: [
    {
      id: 'instruction-' + id,
      name: 'Keep',
      content: 'Unchanged user instructions',
      enabled: true,
    },
  ],
  mainInstruction: 'Unchanged current prompt',
  skills: ['assigned-skill'],
  plugins: ['assigned-package'],
  mcps: [obsolete, 'custom-mcp'],
  model: { connectionId: 'account', provider: 'test', id: 'model', reasoning: 'high', temperature: '' },
  capabilitySettings: {
    ['mcps:' + obsolete]: { enabled: false },
    'mcps:custom-mcp': { enabled: true },
  },
});
const resource = (id: string, source: string) => ({
  id,
  source,
  kind: 'mcps',
  name: 'Resource',
  version: '1',
  description: 'Keep custom text',
  transport: 'HTTP',
  args: '',
  credential: '',
  contents: '',
  createdAt: 1,
});
test('fresh and already-normalized catalogs create no teams, profiles or retired settings', () => {
  const raw = { schemaVersion: 1, sections: {} };
  let ids = 0;
  const clean = retireLegacyFeatures(raw, () => {
    ids++;
    return 'unused';
  });
  assert.equal(clean.document, raw);
  assert.equal(clean.changed, false);
  assert.equal(ids, 0);
  assert.deepEqual(parseStudio(clean.document), {});
});
test('retirement removes only exact known assignments/catalog entries, preserves current user settings and does not mutate input', () => {
  const user = profile('agent'),
    assistant = createSystemAgents(() => 'assistant');
  const resources = [
    resource(obsolete, 'builtin:library'),
    resource('custom-mcp', 'https://example.invalid/mcp'),
  ];
  const raw = {
    schemaVersion: 1,
    sections: {
      agents: [user],
      systemAgents: assistant,
      resources,
      libraryAgents: { characters: user.id, locations: '' },
      hiddenLibraryIds: ['old-asset'],
      baseInstruction: 'User base text',
      connections: [],
    },
  };
  const original = structuredClone(raw);
  const result = retireLegacyFeatures(raw);
  assert.equal(result.changed, true);
  assert.deepEqual(raw, original);
  const parsed = parseStudio(result.document);
  const agent = (parsed.agents as Agent[])[0];
  assert.deepEqual(agent, {
    ...user,
    mcps: ['custom-mcp'],
    capabilitySettings: { 'mcps:custom-mcp': { enabled: true } },
  });
  assert.deepEqual(parsed.resources, [resources[1]]);
  assert.deepEqual(parsed.systemAgents, assistant);
  assert.equal(parsed.baseInstruction, 'User base text');
  assert.equal('libraryAgents' in parsed, false);
  assert.equal('hiddenLibraryIds' in parsed, false);
  assert.equal(retireLegacyFeatures(result.document).changed, false);
  assert.equal(
    retiredBuiltin('my-library-server', 'https://example.invalid/library'),
    false,
    'Similar names never identify a retired built-in',
  );
});
test('former system profiles keep IDs/prompts/models and move to a dedicated team without changing existing teams', () => {
  const char = profile('character-id'),
    loc = profile('location-id');
  const assistant = createSystemAgents(() => 'assistant');
  const teams = [
    { id: 'team-a', name: 'A', agentIds: ['a'] },
    { id: 'team-b', name: 'B', agentIds: ['b'] },
  ];
  const raw = {
    schemaVersion: 1,
    sections: {
      agents: [profile('a'), profile('b')],
      agentTeams: teams,
      systemAgents: [
        { ...char, systemRole: 'character' },
        { ...loc, systemRole: 'location' },
        ...assistant,
      ],
    },
  };
  const result = retireLegacyFeatures(raw, () => 'compat-team');
  const parsed = parseStudio(result.document);
  assert.deepEqual((parsed.agentTeams as unknown[]).slice(0, 2), teams);
  assert.deepEqual((parsed.agentTeams as unknown[])[2], {
    id: 'compat-team',
    name: 'Перенесённые агенты',
    agentIds: [char.id, loc.id],
  });
  const agents = parsed.agents as Agent[];
  for (const original of [char, loc])
    assert.deepEqual(
      agents.find((a) => a.id === original.id),
      withoutRetiredResources(original),
    );
  assert.deepEqual(parsed.systemAgents, assistant);
  assert.equal(retireLegacyFeatures(result.document).changed, false);
});
test('duplicate stable IDs reject the transition without partial changes or silently replacing profiles', () => {
  const agent = profile('same');
  const raw = {
    schemaVersion: 1,
    sections: { agents: [agent], systemAgents: [{ ...agent, systemRole: 'character' }] },
  };
  const before = structuredClone(raw);
  assert.throws(() => retireLegacyFeatures(raw), /ID/);
  assert.deepEqual(raw, before);
});
