import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir, mkdir, rename, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../src/main/storage/StudioStore.ts';
import { buildRunContext } from '../src/main/pi/ContextBuilder.ts';
import { parseTeams, parseProject, projectDocument } from '../src/main/storage/validation.ts';
import { agentSessionDirectory, isSharedTaskPath } from '../src/shared/agentPaths.ts';
import { loadOutput } from '../src/main/storage/outputs.ts';
import { mediaResponse } from '../src/main/storage/media.ts';
import { deleteAgentData } from '../src/main/storage/deleteAgentData.ts';
import { exportTeam } from '../src/main/teams/exportTeam.ts';
import { importTeam } from '../src/main/teams/importTeam.ts';
import { encodePackage, decodePackage, validatePackage } from '../src/main/teams/packageCodec.ts';
import { configureTeam } from '../src/main/pi/teamAdministration.ts';
import type { Agent } from '../src/shared/studio.ts';
// @ts-expect-error bridge JavaScript is exercised directly in Node
import { sessionSystemPrompt } from '../bundled/pi-bridge/prompt.mjs';

const profiles: Agent[] = ['one', 'two'].map((id) => ({
  id,
  name: id,
  enabled: true,
  instructions: [],
  mainInstruction: 'Current role',
  skills: [],
  mcps: [],
  plugins: [],
  model: {
    connectionId: 'connection',
    provider: 'test',
    id: 'test',
    reasoning: 'low',
    temperature: '',
  },
}));
const team = {
  id: 'team',
  name: 'Team',
  agentIds: profiles.map((agent) => agent.id),
  workspaceMode: 'shared' as const,
};
async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-team-workspace-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await StudioStore.open(root);
  await store.saveSection('agentCatalog', { agents: profiles, teams: [team] });
  const project = (
    await store.command({ kind: 'create', name: 'Project', teamId: team.id, agents: profiles })
  ).projects[0];
  return { store, project, root: await store.projects.directory(project.id) };
}

test('shared team work uses the actual project root with hidden separate sessions and no Output/agent folders', async (t) => {
  const f = await fixture(t);
  assert.equal(f.project.workspaceMode, 'shared');
  assert.deepEqual((await readdir(f.root)).sort(), ['.pistudio', 'project.json']);
  const first = await buildRunContext(f.root, f.project, 'one', profiles, []);
  const second = await buildRunContext(f.root, f.project, 'two', profiles, []);
  for (const run of [first, second]) {
    assert.equal(run.record.cwd, f.root);
    assert.equal(run.record.output, f.root);
    assert.equal(
      run.record.sessionDirectory,
      join(f.root, '.pistudio/sessions', run.record.agentId),
    );
    const prompt = sessionSystemPrompt(run);
    assert.match(prompt, /directly in the project root/);
    assert.match(
      prompt,
      /Do not create or use an Output\/output directory or a directory named after an agent/,
    );
    assert.doesNotMatch(prompt, /Prefer cwd-relative output\//);
  }
  assert.notEqual(first.record.leaseDirectory, second.record.leaseDirectory);
  assert.notEqual(first.record.sessionDirectory, second.record.sessionDirectory);
  assert.equal(second.record.previousOutputs[0].path, f.root);
  await writeFile(join(f.root, 'result.md'), 'Shared result');
  const project = await f.store.projects.read(f.project.id);
  for (const agent of project.agents)
    assert.deepEqual(
      agent.entries.map((entry) => entry.name),
      ['result.md'],
    );
  assert.equal((await loadOutput(f.root, 'result.md')).content, 'Shared result');
  await writeFile(join(f.root, 'preview.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  assert.equal(
    (await mediaResponse(f.root, 'preview.svg', new Request('https://qa/'))).status,
    200,
  );
  await assert.rejects(loadOutput(f.root, 'project.json'));
  await assert.rejects(loadOutput(f.root, '.pistudio/context/anything'));
  assert.equal(
    (await mediaResponse(f.root, '.pistudio/private.svg', new Request('https://qa/'))).status,
    403,
  );
  const reopened = await StudioStore.open(f.store.folder);
  assert.equal((await reopened.projects.read(f.project.id)).workspaceMode, 'shared');
  assert.deepEqual(
    parseProject(projectDocument(project)).agents.map((agent) => agent.runtimePath),
    project.agents.map((agent) => agent.runtimePath),
  );
});

test('legacy projects default to separate folders even when their source team uses shared folders', async (t) => {
  const f = await fixture(t);
  const { selectedId } = await f.store.command({
    kind: 'create',
    name: 'Legacy',
    agents: profiles,
  });
  const reopened = await StudioStore.open(f.store.folder);
  const project = reopened.projects.snapshot(selectedId!);
  const root = await reopened.projects.directory(project.id);
  assert.equal(project.sourceTeamId, team.id);
  assert.equal(project.workspaceMode, undefined);
  const run = await buildRunContext(root, project, 'two', profiles, []);
  assert.equal(run.record.workspaceMode, 'per-agent');
  assert.equal(run.record.cwd, join(root, 'agents/two'));
  assert.equal(run.record.output, join(root, 'agents/two/output'));
  assert.equal(run.record.previousOutputs[0].path, join(root, 'agents/one/output'));
  assert.match(sessionSystemPrompt(run), /Prefer cwd-relative output\//);
});

test('team mode is portable, legacy defaults stay separate, administration preserves mode and invalid values fail closed', async (t) => {
  const f = await fixture(t);
  const data = await exportTeam(f.store.agentCatalog(), 'team', [], []);
  assert.equal(data.manifest.team.workspaceMode, 'shared');
  const report = await importTeam(f.store, encodePackage(data));
  assert.equal(
    f.store.agentCatalog().teams.find((team) => team.id === report.teamId)?.workspaceMode,
    'shared',
  );
  await configureTeam(f.store, { id: 'team', name: 'Renamed' });
  assert.equal(
    f.store.agentCatalog().teams.find((team) => team.id === 'team')?.workspaceMode,
    'shared',
  );
  const legacy = { id: 'old', name: 'Legacy', agentIds: [] };
  assert.deepEqual(parseTeams([legacy]), [legacy]);
  assert.throws(() => parseTeams([{ ...legacy, workspaceMode: 'typo' }]));
  assert.throws(() =>
    validatePackage({
      ...data,
      manifest: { ...data.manifest, team: { name: 'Wrong', workspaceMode: 'typo' } },
    }),
  );
});

test('shared clearing trashes only task files and keeps project metadata, all dialogues and legacy outputs', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'result.txt'), 'RESULT');
  await mkdir(join(f.root, 'assets'));
  await writeFile(join(f.root, 'assets/image.svg'), '<svg/>');
  for (const agent of f.project.agents)
    await writeFile(join(f.root, agentSessionDirectory(agent), 'history.jsonl'), 'HISTORY');
  await mkdir(join(f.root, 'agents/legacy/output'), { recursive: true });
  await writeFile(join(f.root, 'agents/legacy/output/keep.txt'), 'LEGACY');
  const document = await readFile(join(f.root, 'project.json'));
  const trashed: string[] = [];
  await deleteAgentData(
    f.store,
    { target: 'files', folder: f.store.folder, projectId: f.project.id, agentId: 'one' },
    async (path) => {
      assert.notEqual(path, f.root);
      trashed.push(path);
      await rename(path, join(f.store.folder, `trash-${trashed.length}`));
    },
  );
  assert.equal(trashed.length, 2);
  assert.deepEqual(await readFile(join(f.root, 'project.json')), document);
  for (const agent of f.project.agents)
    assert.equal(
      await readFile(join(f.root, agentSessionDirectory(agent), 'history.jsonl'), 'utf8'),
      'HISTORY',
    );
  assert.equal(await readFile(join(f.root, 'agents/legacy/output/keep.txt'), 'utf8'), 'LEGACY');
});

test('legacy sessions migrate to .pistudio/sessions by agent ID with exact bytes and recover after interrupted manifest save', async (t) => {
  const f = await fixture(t);
  const agent = f.project.agents[0];
  const canonical = join(f.root, agentSessionDirectory(agent));
  await rm(canonical, { recursive: true });
  await mkdir(join(f.root, 'agents/one/sessions'), { recursive: true });
  const path = 'agents/one/sessions/exact.jsonl';
  await writeFile(join(f.root, path), 'EXACT_LEGACY_BYTES\n');
  await f.store.projects.updateRuntime(f.project.id, 'one', 'waiting', {
    id: 'exact',
    title: 'Exact',
    path,
    createdAt: 1,
  });
  // Simulate interruption after the directory rename but before updating project.json.
  await rename(join(f.root, 'agents/one/sessions'), canonical);
  const reopened = await StudioStore.open(f.store.folder);
  const migrated = await reopened.projects.read(f.project.id);
  assert.equal(migrated.agents[0].session?.id, 'exact');
  assert.equal(migrated.agents[0].session?.path, '.pistudio/sessions/one/exact.jsonl');
  assert.equal(await readFile(join(canonical, 'exact.jsonl'), 'utf8'), 'EXACT_LEGACY_BYTES\n');
  assert.equal((await stat(canonical)).isDirectory(), true);
  for (const path of [
    'project.json',
    '.pistudio/sessions/one/exact.jsonl',
    'agents/one/sessions/exact.jsonl',
    '../outside',
  ])
    assert.equal(isSharedTaskPath(path), false);
});

test('legacy migration defers a live Pi and refuses competing history directories without altering bytes', async (t) => {
  const { spawn } = await import('node:child_process');
  const { migrateAgentSessions } = await import('../src/main/storage/migrateAgentSessions.ts');
  const f = await fixture(t);
  const agent = f.project.agents[0];
  const canonical = join(f.root, agentSessionDirectory(agent));
  await rm(canonical, { recursive: true });
  const legacy = join(f.root, 'agents/one/sessions');
  await mkdir(legacy, { recursive: true });
  await writeFile(join(legacy, 'old.jsonl'), 'KEEP_OLD');
  const script = join(f.store.folder, 'session.mjs');
  await writeFile(script, 'setInterval(()=>{},1000);');
  const child = spawn(process.execPath, [script, 'owned-qa-run'], { stdio: 'ignore' });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  t.after(async () => {
    if (child.exitCode === null) child.kill();
    await exited;
  });
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  await writeFile(
    join(f.root, 'agents/one/.pistudio-session-lock.json'),
    JSON.stringify({ pid: child.pid, runId: 'owned-qa-run' }),
  );
  await assert.rejects(migrateAgentSessions(f.root, agent), /Закройте диалог Pi/);
  assert.equal(child.exitCode, null);
  assert.equal(await readFile(join(legacy, 'old.jsonl'), 'utf8'), 'KEEP_OLD');
  child.kill();
  await exited;
  await mkdir(canonical);
  await writeFile(join(canonical, 'other.jsonl'), 'KEEP_OTHER');
  await assert.rejects(migrateAgentSessions(f.root, agent), /две папки sessions/);
  assert.equal(await readFile(join(legacy, 'old.jsonl'), 'utf8'), 'KEEP_OLD');
  assert.equal(await readFile(join(canonical, 'other.jsonl'), 'utf8'), 'KEEP_OTHER');
});

test('shared root Markdown references resolve task subdirectories and reject outside paths', async (t) => {
  const { markdownFile } = await import('../src/renderer/features/project/model/markdownFiles.ts');
  const f = await fixture(t);
  await mkdir(join(f.root, 'assets'));
  await writeFile(
    join(f.root, 'assets/scene.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/></svg>',
  );
  const file = await loadOutput(f.root, 'assets/scene.svg');
  const context = { projectId: f.project.id, path: 'readme.md', files: [file], onSelect: () => {} };
  assert.equal(markdownFile(context, './assets/scene.svg'), file);
  assert.equal(markdownFile(context, '../outside.svg'), undefined);
});

for (const mode of ['shared', 'per-agent', undefined] as const) {
  test(`team package disk roundtrip preserves ${mode ?? 'legacy default'} mode across studios and restart`, async (t) => {
    const f = await fixture(t);
    await f.store.saveSection('agentCatalog', {
      agents: profiles,
      teams: [
        {
          id: 'team',
          name: 'Portable team',
          agentIds: profiles.map((agent) => agent.id),
          ...(mode === undefined ? {} : { workspaceMode: mode }),
        },
      ],
    });
    const packet = await exportTeam(f.store.agentCatalog(), 'team', [], []);
    const packageFile = join(f.store.folder, 'portable.pistudio-team');
    await writeFile(packageFile, encodePackage(packet));
    const bytes = await readFile(packageFile);
    assert.equal(decodePackage(bytes).manifest.team.workspaceMode, mode);
    const destinationRoot = join(f.store.folder, 'destination');
    const destination = await StudioStore.open(destinationRoot);
    const report = await importTeam(destination, bytes);
    assert.notEqual(report.teamId, 'team');
    const reopened = await StudioStore.open(destinationRoot);
    const imported = reopened.agentCatalog().teams.find((team) => team.id === report.teamId)!;
    assert.equal(imported.workspaceMode, mode);
    assert.equal(imported.workspaceMode ?? 'per-agent', mode ?? 'per-agent');
    const repeatedExport = await exportTeam(reopened.agentCatalog(), imported.id, [], []);
    assert.equal(decodePackage(encodePackage(repeatedExport)).manifest.team.workspaceMode, mode);
    const project = (
      await reopened.command({
        kind: 'create',
        name: 'Imported team project',
        teamId: imported.id,
        agents: reopened.teamProfiles(imported.id),
      })
    ).projects[0];
    assert.equal(project.workspaceMode, mode ?? 'per-agent');
    assert.equal(
      f.store.agentCatalog().teams[0].workspaceMode,
      mode,
      'Import never rewrites the source team',
    );
  });
}
