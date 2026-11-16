import test from 'node:test';
import assert from 'node:assert/strict';
import { exportTeam } from '../src/main/teams/exportTeam.ts';
import { encodePackage, decodePackage, validatePackage } from '../src/main/teams/packageCodec.ts';
import { parseAgents } from '../src/main/storage/validation.ts';

const profile = {
  id: 'one',
  name: 'One',
  enabled: true,
  instructions: [],
  skills: [],
  mcps: [],
  plugins: [],
};
test('portable packages never mix canonical local built-in IDs with package-local resource references', async () => {
  const data = await exportTeam(
    {
      agents: [profile],
      teams: [{ id: 'team', name: 'Team', agentIds: ['one'], workspaceMode: 'shared' }],
    },
    'team',
    [],
    [],
  );
  const bytes = encodePackage(data);
  const reopened = decodePackage(bytes);
  const project = reopened.manifest.resources.find(
    (resource) => resource.source === 'builtin:project',
  )!;
  assert.ok(project);
  assert.deepEqual(reopened.manifest.agents[0].mcps, [project.id]);
  assert.ok(project.id.startsWith('resource-'));
  assert.equal(reopened.manifest.agents[0].mcps.includes('pistudio-project'), false);
  assert.equal(parseAgents([profile], true)[0].mcps.includes('pistudio-project'), true);
  assert.deepEqual(parseAgents([profile], false)[0].mcps, []);
  const broken = structuredClone(reopened);
  broken.manifest.agents[0].mcps.push('pistudio-project');
  assert.throws(() => validatePackage(broken));
});
