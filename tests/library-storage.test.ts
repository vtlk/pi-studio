import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LibraryStore } from '../src/main/library/LibraryStore.ts';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { buildRunContext } from '../src/main/pi/ContextBuilder.ts';
import { libraryTool } from '../src/main/library/tools.ts';
import { writeLibraryFixture, libraryPng } from '../scripts/fixtures/library.mjs';
import { characterFixture } from '../scripts/fixtures/character-rig.ts';

async function fixture(t: { after: (callback: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-library-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'projects/Movie/agents/character/output');
  await mkdir(output, { recursive: true });
  return { root, output, library: new LibraryStore(root) };
}
test('a published data rig enables animation, scopes its reads and revalidates external rig changes', async (t) => {
  const { root, output, library } = await fixture(t);
  const prepared = await library.prepare(output, { kind: 'characters', title: 'Rigged original' });
  await writeLibraryFixture(prepared);
  const { svg, rig } = characterFixture();
  await writeFile(join(prepared.stagingDirectory, 'art.svg'), svg);
  await writeFile(join(prepared.stagingDirectory, 'rig.json'), JSON.stringify(rig));
  await writeFile(
    join(prepared.stagingDirectory, 'asset.json'),
    JSON.stringify({
      ...prepared.manifest,
      files: { ...prepared.manifest.files, vector: 'art.svg', rig: 'rig.json' },
    }),
  );
  assert.equal((await library.validate(output, prepared.token)).animated, true);
  const published = await library.publish(output, prepared.token);
  assert.equal(published.asset.library.animated, true);
  const revision = published.asset.library.revision;
  const data = await library.character(prepared.id, 1, revision);
  assert.equal(data.rig.engine, 'pistudio-character-1');
  await assert.rejects(() =>
    library.media(library.scope, 'characters', prepared.id, 1, 'rig.json'),
  );
  await assert.rejects(() => library.character(prepared.id, 1, 'wrong-revision'));
  const reopened = new LibraryStore(root);
  assert.equal((await reopened.list()).assets[0].library.animated, true);
  await writeFile(
    join(published.directory, 'rig.json'),
    JSON.stringify({ ...rig, defaults: { ...rig.defaults, mouthC: 140 } }),
  );
  await assert.rejects(() => reopened.character(prepared.id, 1, revision), /изменился/);
  const current = (await reopened.list()).assets[0];
  assert.notEqual(current.library.revision, revision);
  await writeFile(
    join(published.directory, 'rig.json'),
    JSON.stringify({ ...rig, engine: 'unsupported' }),
  );
  assert.equal((await reopened.list()).assets.length, 0);
  await assert.rejects(
    () => reopened.character(prepared.id, 1, current.library.revision),
    /версия/,
  );
});
test('publishing current asset data appears once, preserves old versions and survives reopening without seeding', async (t) => {
  const { root, output, library } = await fixture(t);
  assert.deepEqual((await library.list()).assets, []);
  const prepared = await library.prepare(output, {
    kind: 'characters',
    title: 'Robot',
    category: 'Custom',
  });
  await writeLibraryFixture(prepared);
  assert.deepEqual((await library.list()).assets, []);
  assert.ok((await library.validate(output, prepared.token)).validated);
  const first = await library.publish(output, prepared.token);
  assert.equal(first.manifest.version, 1);
  assert.equal(first.asset.library.animated, false);
  assert.equal((await library.list()).assets.length, 1);
  assert.equal((await library.publish(output, prepared.token)).directory, first.directory);
  await assert.rejects(access(prepared.stagingDirectory));
  const bytes = await readFile(join(first.directory, 'art.svg'));
  const update = await library.prepare(output, {
    kind: 'characters',
    existingId: prepared.id,
    title: 'Updated robot',
  });
  await writeLibraryFixture(update, { vector: false });
  const second = await library.publish(output, update.token);
  assert.equal(second.manifest.id, first.manifest.id);
  assert.equal(second.manifest.createdAt, first.manifest.createdAt);
  assert.equal(second.manifest.version, 2);
  assert.deepEqual(await readFile(join(first.directory, 'art.svg')), bytes);
  const reopened = new LibraryStore(root);
  const listing = await reopened.list();
  assert.equal(listing.assets.length, 1);
  assert.equal(listing.assets[0].title, 'Updated robot');
  assert.equal(listing.assets[0].vector, undefined);
  assert.deepEqual(listing.warnings, []);
  assert.equal((await reopened.get('characters', prepared.id, 1)).manifest.title, 'Robot');
});

test('publication rejects another agent preparation, stale updates and unsafe or invalid file sets', async (t) => {
  const { root, output, library } = await fixture(t);
  const other = join(root, 'other-output');
  await mkdir(other);
  const prepared = await library.prepare(output, { kind: 'locations', title: 'Room' });
  await writeLibraryFixture(prepared);
  await assert.rejects(() => library.publish(other, prepared.token), /другим агентом/);
  const manifest = prepared.manifest;
  await writeFile(
    join(prepared.stagingDirectory, 'asset.json'),
    JSON.stringify({ ...manifest, files: { ...manifest.files, vector: '../outside.svg' } }),
  );
  await assert.rejects(() => library.validate(output, prepared.token));
  await writeLibraryFixture(prepared);
  await writeFile(
    join(prepared.stagingDirectory, 'art.svg'),
    '<svg><script>alert(1)</script></svg>',
  );
  await assert.rejects(() => library.publish(output, prepared.token), /SVG/);
  await writeLibraryFixture(prepared);
  const damaged = libraryPng();
  damaged[45] ^= 1;
  await writeFile(join(prepared.stagingDirectory, 'preview.png'), damaged);
  await assert.rejects(() => library.validate(output, prepared.token), /PNG/);
  await writeLibraryFixture(prepared);
  await symlink(
    join(prepared.stagingDirectory, 'reference.png'),
    join(prepared.stagingDirectory, 'source-link'),
  );
  await assert.rejects(() => library.publish(output, prepared.token), /обычные файлы/);
  await rm(join(prepared.stagingDirectory, 'source-link'));
  await library.publish(output, prepared.token);
  const a = await library.prepare(output, {
    kind: 'locations',
    existingId: prepared.id,
    title: 'A',
  });
  const b = await library.prepare(output, {
    kind: 'locations',
    existingId: prepared.id,
    title: 'B',
  });
  await writeLibraryFixture(a);
  await writeLibraryFixture(b);
  await library.publish(output, a.token);
  await assert.rejects(() => library.publish(output, b.token), /уже обновлён/);
  assert.equal((await library.get('locations', prepared.id)).manifest.title, 'A');
});

test('native media is scoped to the studio/version and declared images; external changes are revalidated', async (t) => {
  const { root, output, library } = await fixture(t);
  const prepared = await library.prepare(output, { kind: 'characters', title: 'Viewer' });
  await writeLibraryFixture(prepared);
  const asset = await library.publish(output, prepared.token);
  const media = await library.media(library.scope, 'characters', prepared.id, 1, 'art.svg');
  assert.equal(media.root, asset.directory);
  await assert.rejects(() => library.media('other', 'characters', prepared.id, 1, 'art.svg'));
  for (const file of ['asset.json', 'source/code.ts', '../preview.png'])
    await assert.rejects(() => library.media(library.scope, 'characters', prepared.id, 1, file));
  await writeFile(
    join(asset.directory, 'asset.json'),
    JSON.stringify({ ...asset.manifest, title: 'Changed on disk' }),
  );
  const changed = (await library.list()).assets[0];
  assert.equal(changed.title, 'Changed on disk');
  assert.notEqual(
    changed.vector,
    asset.asset.vector,
    'Changed dependencies must refresh the rendered image URL, even within one version.',
  );
  await writeFile(join(asset.directory, 'art.svg'), '<svg onload="alert(1)"/>');
  const invalid = await library.list();
  assert.equal(invalid.assets.length, 0);
  assert.ok(invalid.warnings.length > 0);
  await assert.rejects(() => library.media(library.scope, 'characters', prepared.id, 1, 'art.svg'));
  assert.notEqual(new LibraryStore(join(root, 'other-studio')).scope, library.scope);
});

test('production tools use their bound studio; removed cards disappear from discovery while pinned source references remain readable', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-library-mcp-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new StudioService(join(root, 'preferences.json'), join(root, 'studio'));
  const store = await service.load();
  const profile = {
    id: 'agent',
    name: 'Artist',
    enabled: true,
    instructions: [],
    skills: [],
    mcps: [],
    plugins: [],
    model: {
      provider: 'provider',
      id: 'model',
      connectionId: 'connection',
      reasoning: 'low',
      temperature: '',
    },
  };
  const project = (await store.command({ kind: 'create', name: 'Movie', agents: [profile] }))
    .projects[0];
  const run = await buildRunContext(
    await store.projects.directory(project.id),
    project,
    profile.id,
    [profile],
    [],
  );
  const prepared = (await libraryTool(service, run, 'library_prepare_asset', {
    kind: 'characters',
    title: 'MCP robot',
  })) as Awaited<ReturnType<LibraryStore['prepare']>>;
  await writeLibraryFixture(prepared);
  await libraryTool(service, run, 'library_validate_asset', { token: prepared.token });
  await libraryTool(service, run, 'library_publish_asset', { token: prepared.token });
  const find = () =>
    libraryTool(service, run, 'library_find_assets', { query: 'robot' }) as Promise<{
      assets: unknown[];
    }>;
  assert.equal((await find()).assets.length, 1);
  await store.saveSection('hiddenLibraryIds', [prepared.id]);
  assert.deepEqual((await find()).assets, []);
  const pinned = (await libraryTool(service, run, 'library_get_asset', {
    kind: 'characters',
    id: prepared.id,
    version: 1,
  })) as Awaited<ReturnType<LibraryStore['get']>>;
  assert.equal(pinned.manifest.version, 1);
  await service.open(join(root, 'another-studio'));
  await assert.rejects(() =>
    libraryTool(service, run, 'library_get_asset', { kind: 'characters', id: prepared.id }),
  );
});
