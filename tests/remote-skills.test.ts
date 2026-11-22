import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { StudioService, StudioStore } from '../src/main/storage/StudioStore.ts';
import { RemoteSkillInstaller } from '../src/main/skills/RemoteSkillInstaller.ts';
import { SetupAdministration } from '../src/main/pi/SetupAdministration.ts';
import { setupTools } from '../src/main/pi/setupTools.ts';
import { parseAgent } from '../src/main/storage/validation.ts';
import type { Resource } from '../src/shared/resources.ts';
import type { SystemAgent } from '../src/shared/systemAgents.ts';
import type { PreparedRun } from '../src/main/pi/ContextBuilder.ts';
import { updateZip } from './helpers/updateZip.ts';
import { buildRunContext } from '../src/main/pi/ContextBuilder.ts';

const body = (name: string) =>
  `---\nname: ${name}\ndescription: Downloaded skill fixture\n---\n\nUse the current companion files.\n`;
const archive = (name = 'downloaded-skill') =>
  updateZip([
    { name: 'repo-main/skills/wanted/SKILL.md', text: body(name) },
    { name: 'repo-main/skills/wanted/references/Тест.md', text: 'Keep reference files' },
    {
      name: 'repo-main/skills/wanted/scripts/action.js',
      text: 'throw Error("must never execute during installation")',
      mode: 0o100755,
    },
    {
      name: 'repo-main/skills/wanted/package.json',
      text: '{"scripts":{"postinstall":"throw Error()"}}',
    },
  ]);
async function fixture(t: { after(action: () => Promise<unknown>): void }) {
  const root = await mkdtemp(join(tmpdir(), "pistudio-url-Тест O'Brien-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new StudioService(join(root, 'preferences.json'), join(root, 'studio'));
  const store = await service.load();
  const agents = ['a', 'b'].map((id) =>
    parseAgent({
      id,
      name: id,
      enabled: true,
      instructions: [],
      mainInstruction: `Preserve ${id}`,
      skills: [],
      mcps: [],
      plugins: [],
      model: {
        connectionId: 'fixture',
        provider: 'fixture',
        id: 'fixture',
        reasoning: 'off',
        temperature: '0.7',
      },
    }),
  );
  await store.saveSection('agentCatalog', {
    agents,
    teams: [{ id: 'team', name: 'Team', agentIds: ['a', 'b'] }],
  });
  const helper = (store.bootstrap().sections.systemAgents as SystemAgent[])[0];
  const run = { projectRoot: join(store.folder, '.pistudio/setup-assistant') } as PreparedRun;
  const install = (request: typeof fetch) => new RemoteSkillInstaller(service, request);
  return { root, store, service, agents, helper, run, install };
}
const from =
  (bytes: Uint8Array): typeof fetch =>
  async () =>
    new Response(bytes);
async function skillFolders(folder: string) {
  return readdir(join(folder, '.pistudio/skills')).catch(() => []);
}

const githubCommit = 'a'.repeat(40);
const skillTree = 'b'.repeat(40);
const githubFiles = new Map([
  ['SKILL.md', body('github-scoped-skill')],
  ['references/ notes.md', 'Keep just the companion files'],
  ['empty.txt', ''],
]);
const githubBlob = (path: string, content: string) => ({
  path,
  type: 'blob',
  mode: '100644',
  size: Buffer.byteLength(content),
  sha: createHash('sha1')
    .update(`blob ${Buffer.byteLength(content)}\0`)
    .update(content)
    .digest('hex'),
});
const githubEntries = [
  ...Array.from(githubFiles, ([path, content]) => githubBlob(path, content)),
  { path: 'references', type: 'tree', mode: '040000', sha: 'c'.repeat(40) },
];
function githubFixture(
  entries = githubEntries,
  raw = githubFiles,
  accessed: string[] = [],
): typeof fetch {
  return async (input, options) => {
    const url = new URL(String(input));
    accessed.push(url.href);
    assert.equal(options?.credentials, 'omit');
    assert.equal(new Headers(options?.headers).has('authorization'), false);
    if (url.pathname.endsWith('/commits/main')) return new Response(githubCommit);
    if (url.pathname.includes('/commits/')) return new Response(null, { status: 404 });
    if (url.pathname.endsWith('/git/trees/' + githubCommit))
      return Response.json({
        truncated: false,
        tree: [
          { path: 'wanted', type: 'tree', mode: '040000', sha: skillTree },
          { path: 'irrelevant-large.bin', type: 'blob', mode: '100644', size: 300 * 1024 ** 2 },
        ],
      });
    if (url.pathname.endsWith('/git/trees/' + skillTree)) {
      assert.equal(url.searchParams.get('recursive'), '1');
      return Response.json({ truncated: false, tree: entries });
    }
    const prefix = `/owner/repo/${githubCommit}/wanted/`;
    assert.equal(url.hostname, 'raw.githubusercontent.com');
    assert.ok(url.pathname.startsWith(prefix));
    const value = raw.get(decodeURIComponent(url.pathname.slice(prefix.length)));
    assert.ok(value !== undefined);
    return new Response(value);
  };
}

test('an exact GitHub skill path downloads only its pinned tree and preserves companion files', async (t) => {
  const f = await fixture(t);
  const accessed: string[] = [];
  const result = await f
    .install(githubFixture(githubEntries, githubFiles, accessed))
    .install(f.run, {
      url: 'https://github.com/owner/repo',
      ref: 'main',
      skillPath: 'wanted',
      agentIds: ['a'],
    });
  assert.ok(result.installed && result.resource);
  assert.equal(result.githubCommit, githubCommit);
  assert.equal(result.archiveSha256, undefined);
  for (const [path, content] of githubFiles)
    assert.equal(await readFile(join(result.resource.source, path), 'utf8'), content);
  assert.deepEqual(f.store.agentCatalog().agents[0].skills, [result.resource.id]);
  assert.deepEqual(f.store.agentCatalog().agents[1].skills, []);
  assert.ok(accessed.every((url) => !url.includes('/zipball/')));
});

test('a GitHub repository link discovers skills from metadata without downloading unrelated content', async (t) => {
  const f = await fixture(t);
  const accessed: string[] = [];
  const fetchSelected = githubFixture(githubEntries, githubFiles, accessed);
  let multiple = true;
  const installer = f.install(async (input, options) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/git/trees/' + githubCommit) && url.searchParams.has('recursive'))
      return Response.json({
        truncated: false,
        tree: [
          ...githubEntries.map((entry) => ({ ...entry, path: 'wanted/' + entry.path })),
          ...(multiple ? [githubBlob('second/SKILL.md', body('second'))] : []),
          { path: 'unrelated.iso', type: 'blob', mode: '100644', size: 500 * 1024 ** 2 },
        ],
      });
    return fetchSelected(input, options);
  });
  const args = { url: 'https://github.com/owner/repo', ref: 'main', agentIds: ['a'] };
  const choices = await installer.install(f.run, args);
  assert.equal(choices.selectionRequired, true);
  assert.deepEqual(choices.skills, [{ path: 'wanted' }, { path: 'second' }]);
  assert.equal(accessed.length, 1, 'Discovery used only commit and tree metadata');
  assert.deepEqual(f.store.bootstrap().sections.resources, []);
  multiple = false;
  const result = await installer.install(f.run, args);
  assert.ok(result.installed && result.resource);
  assert.equal(result.resource.name, 'github-scoped-skill');
  assert.ok(accessed.every((url) => !url.includes('/zipball/')));
});

test('an explicit GitHub archive SHA-256 still verifies the original ZIP', async (t) => {
  const f = await fixture(t);
  const bytes = archive();
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const result = await f
    .install(async (url) => {
      if (String(url).endsWith('/commits/main')) return new Response(githubCommit);
      assert.ok(String(url).endsWith('/zipball/' + githubCommit));
      return new Response(bytes);
    })
    .install(f.run, {
      url: 'https://github.com/owner/repo',
      ref: 'main',
      skillPath: 'skills/wanted',
      agentIds: ['a'],
      sha256,
    });
  assert.equal(result.installed, true);
  assert.equal(result.githubCommit, githubCommit);
  assert.equal(result.archiveSha256, sha256);
});

test('GitHub and ZIP imports quote a plain description with a colon and preserve the skill body', async (t) => {
  const description = 'Draw illustrations. Identifying traits: black outlines.';
  const bodyText = '\r\nUse the existing references.\r\n';
  const original = `---\r\nname: github-scoped-skill\r\ndescription: ${description}\r\n---\r\n${bodyText}`;
  const files = new Map(githubFiles).set('SKILL.md', original);
  const entries = [
    githubBlob('SKILL.md', original),
    ...githubEntries.filter(({ path }) => path !== 'SKILL.md'),
  ];
  for (const [url, request] of [
    ['https://github.com/owner/repo/tree/main/wanted', githubFixture(entries, files)],
    ['https://example.com/skill.zip', from(updateZip([{ name: 'SKILL.md', text: original }]))],
  ] as const) {
    const f = await fixture(t);
    const result = await f.install(request).install(f.run, { url, agentIds: ['a'] });
    assert.ok(result.installed && result.resource);
    assert.equal(result.frontmatterNormalized, true);
    assert.equal(result.resource.description, description);
    assert.equal(
      await readFile(join(result.resource.source, 'SKILL.md'), 'utf8'),
      original.replace(description, JSON.stringify(description)),
    );
  }
});

test('GitHub folder limits, links, collisions and corrupted blobs cannot publish a partial skill', async (t) => {
  const f = await fixture(t);
  const args = {
    url: 'https://github.com/owner/repo/blob/main/wanted/SKILL.md',
    ref: 'main',
    agentIds: ['a'],
  };
  for (const invalid of [
    [...githubEntries, { ...githubBlob('large.bin', ''), size: 21 * 1024 ** 2 }],
    [...githubEntries, { ...githubBlob('link', 'other'), mode: '120000' }],
    [...githubEntries, githubBlob('References/alias.md', 'mixed case')],
    [...githubEntries, githubBlob('../outside', 'unsafe')],
  ]) {
    const accessed: string[] = [];
    await assert.rejects(
      f.install(githubFixture(invalid, githubFiles, accessed)).install(f.run, args),
    );
    assert.ok(accessed.every((url) => !url.includes('raw.githubusercontent.com')));
  }
  const corrupted = new Map(githubFiles);
  corrupted.set('references/ notes.md', 'Wrong bytes');
  await assert.rejects(
    f.install(githubFixture(githubEntries, corrupted)).install(f.run, args),
    /коммите GitHub/,
  );
  assert.deepEqual(f.store.bootstrap().sections.resources, []);
  assert.deepEqual(await skillFolders(f.store.folder), []);
});

test('the actual administration tool downloads ZIP, preserves companions and atomically assigns only selected current profiles', async (t) => {
  const f = await fixture(t);
  const prior = f.store.bootstrap().sections;
  const existing = (
    await f.store.command({
      kind: 'create',
      name: 'Existing',
      teamId: 'team',
      agents: f.store.teamProfiles('team'),
    })
  ).projects[0];
  const existingFile = join(await f.store.projects.directory(existing.id), 'project.json');
  const existingBytes = await readFile(existingFile);
  const bytes = archive();
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const admin = new SetupAdministration(
    f.service,
    async () => {
      throw Error('Model catalog is unnecessary');
    },
    undefined,
    undefined,
    f.install(from(bytes)),
  );
  const result = (await admin.call(f.run, 'install_skill_from_url', {
    url: 'https://example.com/skill.zip',
    agentIds: ['a', f.helper.id],
    sha256,
  })) as {
    installed: boolean;
    resource: Resource;
    agentIds: string[];
    loadedInAgentSession: boolean;
  };
  assert.equal(result.installed, true);
  assert.equal(result.loadedInAgentSession, false);
  const sections = f.store.bootstrap().sections;
  assert.equal((sections.resources as Resource[])[0].id, result.resource.id);
  assert.deepEqual(f.store.agentCatalog().agents[0].skills, [result.resource.id]);
  assert.deepEqual(f.store.agentCatalog().agents[1], f.agents[1]);
  assert.deepEqual((sections.systemAgents as SystemAgent[])[0].skills, [result.resource.id]);
  assert.equal(f.store.agentCatalog().agents[0].mainInstruction, 'Preserve a');
  assert.deepEqual(sections.agentTeams, prior.agentTeams);
  assert.deepEqual(sections.connections, prior.connections);
  assert.deepEqual(
    await readFile(existingFile),
    existingBytes,
    'Installing into constructor profiles never rewrites an existing project',
  );
  assert.equal(
    await readFile(join(result.resource.source, 'references/Тест.md'), 'utf8'),
    'Keep reference files',
  );
  assert.match(
    await readFile(join(result.resource.source, 'scripts/action.js'), 'utf8'),
    /must never execute/,
  );
  if (process.platform !== 'win32')
    assert.ok((await stat(join(result.resource.source, 'scripts/action.js'))).mode & 0o100);
  assert.deepEqual(await skillFolders(f.store.folder), [result.resource.id]);
  const reopened = await StudioStore.open(f.store.folder);
  assert.deepEqual(reopened.agentCatalog().agents[0].skills, [result.resource.id]);
  assert.equal(
    setupTools.some((tool) => tool.name === 'install_skill_from_url'),
    true,
  );
  // The normal project context consumes the downloaded skill as a file, not a prompt snapshot.
  const project = (
    await f.store.command({
      kind: 'create',
      name: 'QA',
      teamId: 'team',
      agents: f.store.teamProfiles('team'),
    })
  ).projects[0];
  const context = await buildRunContext(
    await f.store.projects.directory(project.id),
    project,
    'a',
    f.store.agentCatalog().agents,
    sections.resources as Resource[],
  );
  assert.equal(context.resources.skills[0].path, result.resource.source);
});

test('multi-skill archives return choices without publishing; an exact path installs only that skill', async (t) => {
  const f = await fixture(t);
  const bytes = updateZip([
    { name: 'repo-main/skills/one/SKILL.md', text: body('one') },
    { name: 'repo-main/skills/two/SKILL.md', text: body('two') },
  ]);
  const installer = f.install(from(bytes));
  const args = { url: 'https://example.com/skills.zip', agentIds: ['a'] };
  const choices = (await installer.install(f.run, args)) as {
    selectionRequired: boolean;
    skills: { path: string }[];
  };
  assert.equal(choices.selectionRequired, true);
  assert.deepEqual(
    choices.skills.map((skill) => skill.path),
    ['skills/one', 'skills/two'],
  );
  assert.deepEqual(f.store.bootstrap().sections.resources, []);
  assert.deepEqual(await skillFolders(f.store.folder), []);
  const installed = (await installer.install(f.run, { ...args, skillPath: 'skills/two' })) as {
    resource: Resource;
  };
  assert.equal(installed.resource.name, 'two');
  assert.deepEqual(await readdir(installed.resource.source), ['SKILL.md']);
});

test('duplicate names, bad frontmatter, wrong hashes and missing targets preserve existing files and assignments', async (t) => {
  const f = await fixture(t);
  const args = { url: 'https://example.com/skill.zip', agentIds: ['a'] };
  const installer = f.install(from(archive()));
  const installed = (await installer.install(f.run, args)) as { resource: Resource };
  const before = await readFile(join(f.store.folder, '.pistudio/studio.json'), 'utf8');
  await assert.rejects(installer.install(f.run, { ...args, agentIds: ['b'] }), /существует/);
  await assert.rejects(installer.install(f.run, { ...args, sha256: '0'.repeat(64) }), /SHA-256/);
  await assert.rejects(installer.install(f.run, { ...args, agentIds: ['missing'] }));
  await assert.rejects(installer.install(f.run, { ...args, agentIds: ['a', 'a'] }));
  await assert.rejects(
    f.install(from(updateZip([{ name: 'SKILL.md', text: '# bad' }]))).install(f.run, args),
  );
  assert.equal(await readFile(join(f.store.folder, '.pistudio/studio.json'), 'utf8'), before);
  assert.deepEqual(await skillFolders(f.store.folder), [installed.resource.id]);
});

test('cancellation and a studio switch during download never publish partial resources', async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  const bytes = archive();
  let cancelled = false;
  const installer = f.install(
    async () =>
      new Response(
        new ReadableStream({
          start(stream) {
            stream.enqueue(bytes.subarray(0, 20));
            setImmediate(() => controller.abort());
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  );
  await assert.rejects(
    installer.install(
      f.run,
      { url: 'https://example.com/file.zip', agentIds: ['a'] },
      controller.signal,
    ),
  );
  assert.equal(cancelled, true);
  assert.deepEqual(f.store.bootstrap().sections.resources, []);
  const switched = f.install(async () => {
    await f.service.serialize(() => f.service.open(join(f.root, 'another')));
    return new Response(bytes);
  });
  await assert.rejects(
    switched.install(f.run, { url: 'https://example.com/file.zip', agentIds: ['a'] }),
  );
  assert.deepEqual((await f.service.load()).bootstrap().sections.resources, []);
  assert.deepEqual(f.store.bootstrap().sections.resources, []);
  assert.deepEqual(await skillFolders(f.store.folder), []);
});

test('ordinary-agent administration revocation is rechecked before committing a downloaded skill', async (t) => {
  const f = await fixture(t);
  const a = { ...f.agents[0], mcps: ['pistudio-project', 'pistudio-administration'] };
  await f.store.saveSection('agents', [a, f.agents[1]]);
  const project = (await f.store.command({ kind: 'create', name: 'QA', agents: [a] })).projects[0];
  const run = {
    projectRoot: await f.store.projects.directory(project.id),
    project,
    agent: project.agents[0],
  } as PreparedRun;
  const installer = f.install(async () => {
    await f.service.serialize(() =>
      f.store.saveSection('agents', [{ ...a, mcps: ['pistudio-project'] }, f.agents[1]]),
    );
    return new Response(archive());
  });
  await assert.rejects(
    installer.install(run, { url: 'https://example.com/file.zip', agentIds: ['b'] }),
  );
  assert.deepEqual(f.store.bootstrap().sections.resources, []);
  assert.deepEqual(f.store.agentCatalog().agents[1].skills, []);
  assert.deepEqual(await skillFolders(f.store.folder), []);
});
