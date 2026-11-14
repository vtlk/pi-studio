import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { createStudioRunHost } from '../src/main/pi/createStudioRunHost.ts';
import { createLibraryRunHost } from '../src/main/pi/createLibraryRunHost.ts';
import { createSetupAssistant } from '../src/main/pi/createSetupAssistant.ts';
import { ReferenceFiles } from '../src/main/pi/ReferenceFiles.ts';
import type { Agent } from '../src/shared/studio.ts';
import type { SystemAgent } from '../src/shared/systemAgents.ts';
import type { Connection } from '../src/shared/connections.ts';

async function files(root: string): Promise<Record<string, string>> {
  const entries: Record<string, string> = {};
  for (const item of await readdir(root, { withFileTypes: true })) {
    const path = join(root, item.name);
    if (item.isDirectory())
      for (const [key, value] of Object.entries(await files(path)))
        entries[join(item.name, key)] = value;
    else
      entries[item.name] = createHash('sha256')
        .update(await readFile(path))
        .digest('hex');
  }
  return entries;
}

test('all launch adapters reject incomplete/mismatched model settings before creating any run files', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-preflight-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new StudioService(join(root, 'prefs.json'), join(root, 'Studio'));
  const store = await service.load();
  const model = {
    connectionId: 'account',
    provider: 'provider',
    id: 'model',
    reasoning: 'Низкий',
    temperature: '',
  };
  const agent: Agent = {
    id: 'artist',
    name: 'Artist',
    enabled: true,
    instructions: [],
    skills: [],
    mcps: ['pistudio-library'],
    plugins: [],
    model,
  };
  const assistant = (store.bootstrap().sections.systemAgents as SystemAgent[])[0];
  const connection: Connection = {
    id: 'account',
    providerId: 'provider',
    purpose: 'pi',
    name: 'Account',
    endpoint: '',
    account: '',
    createdAt: 1,
  };
  await store.saveSection('agents', [agent]);
  const project = (await store.command({ kind: 'create', name: 'QA', agents: [agent] }))
    .projects[0];
  const options = {
    bootstraps: join(root, 'boots'),
    bridge: join(root, 'missing-session.mjs'),
    catalog: join(root, 'missing-catalog.mjs'),
    piPath: () => join(root, 'missing-pi'),
    references: new ReferenceFiles(),
    openTerminal: async () => assert.fail('No Terminal or model request should start'),
  };
  const production = createStudioRunHost(service, options);
  const helper = createSetupAssistant(service, options);
  const library = createLibraryRunHost(service, options);
  t.after(async () => {
    await production.close();
    await helper.close();
    await library.close();
  });
  for (const invalid of [
    { model: { ...model, reasoning: '' }, connections: [connection] },
    { model: { ...model, reasoning: '  ' }, connections: [connection] },
    { model, connections: [] },
    { model, connections: [{ ...connection, purpose: 'images' as const }] },
    { model, connections: [{ ...connection, providerId: 'wrong' }] },
  ]) {
    await store.saveSection('agents', [{ ...agent, model: invalid.model }]);
    await store.saveSection('systemAgents', [{ ...assistant, model: invalid.model }]);
    await store.saveSection('connections', invalid.connections);
    const before = await files(root);
    await assert.rejects(
      production.launch({
        projectId: project.id,
        agentId: agent.id,
        firstMessage: 'QA',
        autoContinue: false,
      }),
      /подключение.*модель/,
    );
    await assert.rejects(
      helper.launch({
        projectId: 'pi-setup-assistant',
        agentId: assistant.id,
        autoContinue: false,
      }),
      /подключение.*модель/,
    );
    for (const kind of ['characters', 'locations'] as const)
      await assert.rejects(
        library.create({ kind, agentId: agent.id, description: 'QA', attachments: [] }),
        /подключение.*модель/,
      );
    assert.deepEqual(
      await files(root),
      before,
      'Failed preflight must preserve every file and create no session/job/context/auth directory',
    );
  }
});
