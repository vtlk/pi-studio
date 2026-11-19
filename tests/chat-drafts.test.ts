import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, lstat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { ChatDrafts } from '../src/main/pi/ChatDrafts.ts';
import { ReferenceFiles, readReferenceBytes } from '../src/main/pi/ReferenceFiles.ts';
import { ChatDraftStore, chatDraftKey } from '../src/renderer/features/chat/ChatDraftStore.ts';
const target = { projectId: 'project-a', agentId: 'agent-a' };
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const statePath = (root: string, folder: string, t = target) =>
  join(
    root,
    'chat-drafts',
    sha(folder),
    sha(JSON.stringify([t.projectId, t.agentId])),
    'draft.json',
  );
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { resolve, promise };
}

test('draft text and owned attachments survive a new registry/app instance, original-file deletion and separate studios', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-drafts-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const refs = new ReferenceFiles(),
    disk = new ChatDrafts(root, refs);
  disk.authorize('/studio-a');
  disk.authorize('/studio-b');
  const source = join(root, 'input.txt');
  await writeFile(source, 'ORIGINAL');
  const [input] = await refs.select([source], '/studio-a');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB6sAAAAASUVORK5CYII=',
    'base64',
  );
  const image = await refs.paste(png, join(root, 'clipboard'), '/studio-a');
  image.preview = 'data:image/png;base64,AA==';
  await disk.save({
    folder: '/studio-a',
    ...target,
    revision: 1,
    text: 'Русский черновик',
    attachments: [input.id, image.id],
  });
  await disk.save({
    folder: '/studio-b',
    ...target,
    revision: 1,
    text: 'Other studio',
    attachments: [],
  });
  await rm(source);
  refs.release([input.id, image.id]);
  await disk.close();
  const freshRefs = new ReferenceFiles(),
    fresh = new ChatDrafts(root, freshRefs);
  fresh.authorize('/studio-a');
  fresh.authorize('/studio-b');
  const [restored] = await fresh.load('/studio-a');
  assert.equal(restored.text, 'Русский черновик');
  assert.equal(restored.attachments.length, 2);
  assert.notEqual(restored.attachments[0].id, input.id);
  const items = freshRefs.validate(
    restored.attachments.map((f) => f.id),
    '/studio-a',
    true,
  );
  assert.equal((await readReferenceBytes(items[0].path)).toString(), 'ORIGINAL');
  assert.deepEqual(await readReferenceBytes(items[1].path), png);
  assert.equal(restored.attachments[1].preview, image.preview);
  assert.equal((await fresh.load('/studio-b'))[0].text, 'Other studio');
  assert.throws(() =>
    freshRefs.validate(
      restored.attachments.map((f) => f.id),
      '/studio-b',
      true,
    ),
  );
  await assert.rejects(
    fresh.save({
      folder: '/studio-a',
      projectId: 'project-a',
      agentId: 'agent-b',
      revision: 1,
      text: 'Wrong agent',
      attachments: [restored.attachments[0].id],
    }),
  );
  assert.equal(
    (await lstat(statePath(root, '/studio-a'))).mode & 0o777,
    process.platform === 'win32' ? 0o666 : 0o600,
  );
});

test('serialized revisions and send consumption never clear a newer draft; released attachment blobs are collected', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-draft-send-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const refs = new ReferenceFiles(),
    changes: unknown[] = [],
    disk = new ChatDrafts(root, refs, (c) => changes.push(c));
  disk.authorize('/studio');
  const source = join(root, 'source.txt');
  await writeFile(source, 'KEEP SOURCE');
  const [file] = await refs.select([source], '/studio');
  await disk.save({
    folder: '/studio',
    ...target,
    revision: 1,
    text: 'sent text',
    attachments: [file.id],
  });
  await disk.save({
    folder: '/studio',
    ...target,
    revision: 2,
    text: 'newer text',
    attachments: [file.id],
  });
  assert.equal((await disk.consume('/studio', target.projectId, target.agentId, 1)).cleared, false);
  assert.equal((await disk.load('/studio'))[0].text, 'newer text');
  const active = (await disk.load('/studio'))[0].attachments.map((f) => f.id);
  assert.deepEqual(await disk.consume('/studio', target.projectId, target.agentId, 2), {
    cleared: true,
    revision: 3,
  });
  assert.equal(changes.length, 1);
  refs.release(active);
  await disk.close();
  assert.deepEqual(await readdir(join(statePath(root, '/studio'), '../files')), []);
  assert.equal((await disk.load('/studio'))[0].text, '');
  await disk.save({
    folder: '/studio',
    ...target,
    revision: 4,
    text: 'next message',
    attachments: [],
  });
  assert.equal((await disk.load('/studio'))[0].text, 'next message');
  assert.equal(await readFile(source, 'utf8'), 'KEEP SOURCE');
});

test('failed attachment saves roll back only owned new blobs; malformed state is never overwritten on load', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-draft-fail-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const refs = new ReferenceFiles(),
    disk = new ChatDrafts(root, refs);
  disk.authorize('/studio');
  const a = join(root, 'a.txt'),
    b = join(root, 'b.txt');
  await writeFile(a, 'a');
  await writeFile(b, 'b');
  const selected = await refs.select([a, b], '/studio');
  await writeFile(b, 'changed');
  await assert.rejects(
    disk.save({
      folder: '/studio',
      ...target,
      revision: 1,
      text: 'Keep in renderer',
      attachments: selected.map((f) => f.id),
    }),
  );
  assert.deepEqual(await readdir(join(statePath(root, '/studio'), '../files')), []);
  assert.equal(await readFile(a, 'utf8'), 'a');
  await writeFile(statePath(root, '/studio'), '{broken');
  await assert.rejects(disk.load('/studio'));
  assert.equal(await readFile(statePath(root, '/studio'), 'utf8'), '{broken');
  await assert.rejects(
    disk.save({ folder: '/unvisited', ...target, revision: 1, text: 'no', attachments: [] }),
  );
  const dir = join(root, 'chat-drafts', sha('/other'));
  await mkdir(dir, { recursive: true });
  if (process.platform !== 'win32') {
    await symlink(join(root, 'chat-drafts', sha('/studio')), join(dir, 'a'.repeat(64)));
    disk.authorize('/other');
    await assert.rejects(disk.load('/other'));
  }
});

test('pinned clipboard input cannot disappear while a draft copy is in progress', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-draft-pin-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const refs = new ReferenceFiles();
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  const file = await refs.paste(png, join(root, 'clip'), '/studio');
  const pin = refs.acquire([file.id], '/studio'),
    temporary = pin.items[0].path;
  refs.release([file.id]);
  assert.deepEqual(await readFile(temporary), png);
  const durable = join(root, 'owned.png');
  await writeFile(durable, png);
  refs.promote(pin.items[0], durable, 'draft');
  pin.release();
  for (let i = 0; i < 50; i++) {
    try {
      await lstat(temporary);
    } catch {
      break;
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  await assert.rejects(readFile(temporary));
  assert.deepEqual(await readFile(durable), png);
});

test('renderer restores saved drafts without blocking updates and flushes the newest edit across studios', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-draft-client-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let registry = new ReferenceFiles(),
    disk = new ChatDrafts(root, registry);
  const gate = deferred(),
    started = deferred();
  let hold = false,
    fail = false,
    writes = 0;
  const api = {
    loadChatDrafts: async ({ folder }: { folder: string }) => {
      disk.authorize(folder);
      return { folder, drafts: await disk.load(folder) };
    },
    saveChatDraft: async (request: Parameters<ChatDrafts['save']>[0]) => {
      writes++;
      if (hold) {
        started.resolve();
        await gate.promise;
      }
      if (fail) throw Error('disk unavailable');
      return disk.save(request);
    },
  };
  const first = new ChatDraftStore(api);
  await first.load('/studio-a');
  const key = chatDraftKey('/studio-a', target);
  first.setText(key, 'Черновик');
  assert.equal(first.unsaved(), true);
  assert.equal(await first.flush(), true);
  assert.equal(first.unsaved(), false);
  registry = new ReferenceFiles();
  disk = new ChatDrafts(root, registry);
  const restored = new ChatDraftStore(api);
  await restored.load('/studio-a');
  assert.equal(restored.drafts.get(key), 'Черновик');
  assert.equal(restored.unsaved(), false);
  await restored.load('/studio-b');
  const other = chatDraftKey('/studio-b', target);
  restored.setText(other, 'B');
  await restored.flush();
  hold = true;
  restored.setText(key, 'older');
  const saving = restored.flush(key);
  await started.promise;
  restored.setText(key, 'latest');
  assert.equal(restored.unsaved(), true);
  hold = false;
  gate.resolve();
  assert.equal(await saving, true);
  assert.equal(restored.unsaved(), false);
  assert.equal((await disk.load('/studio-a'))[0].text, 'latest');
  assert.equal((await disk.load('/studio-b'))[0].text, 'B');
  fail = true;
  restored.setText(key, 'unsaved');
  assert.equal(await restored.flush(key), false);
  assert.ok(restored.error());
  assert.equal(restored.unsaved(), true);
  fail = false;
  assert.equal(await restored.retry(), true);
  assert.equal(restored.unsaved(), false);
  assert.equal((await disk.load('/studio-a'))[0].text, 'unsaved');
  assert.ok(writes >= 5);
});

test('a send acknowledgement cannot erase voice text added during dispatch, even when its revision collides with the server tombstone', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-draft-cas-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const refs = new ReferenceFiles();
  let client: ChatDraftStore;
  const disk = new ChatDrafts(root, refs, (change) => client.consumed(change));
  const api = {
    loadChatDrafts: async ({ folder }: { folder: string }) => {
      disk.authorize(folder);
      return { folder, drafts: await disk.load(folder) };
    },
    saveChatDraft: (request: Parameters<ChatDrafts['save']>[0]) => disk.save(request),
  };
  client = new ChatDraftStore(api);
  await client.load('/studio');
  const key = chatDraftKey('/studio', target);
  client.setText(key, 'sent');
  await client.flush();
  const snapshot = client.current(key);
  client.setText(key, 'sent + new voice');
  const result = await disk.consume('/studio', target.projectId, target.agentId, snapshot.revision);
  client.sent(key, snapshot.revision, { draft: result });
  assert.equal(client.drafts.get(key), 'sent + new voice');
  assert.equal(await client.flush(), true);
  assert.equal((await disk.load('/studio'))[0].text, 'sent + new voice');
  const sent = client.current(key);
  const cleared = await disk.consume('/studio', target.projectId, target.agentId, sent.revision);
  client.sent(key, sent.revision, { draft: cleared });
  assert.equal(client.drafts.get(key), '');
  assert.equal(client.unsaved(), false);
});

test('a fresh app collects only obsolete owned blobs left after a sent draft was cleared', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-draft-gc-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const refs = new ReferenceFiles(),
    disk = new ChatDrafts(root, refs);
  disk.authorize('/studio');
  const source = join(root, 'keep.txt');
  await writeFile(source, 'keep');
  const [file] = await refs.select([source], '/studio');
  await disk.save({
    folder: '/studio',
    ...target,
    revision: 1,
    text: 'message',
    attachments: [file.id],
  });
  await disk.consume('/studio', target.projectId, target.agentId, 1);
  const files = join(statePath(root, '/studio'), '../files');
  assert.equal((await readdir(files)).length, 1);
  const fresh = new ChatDrafts(root, new ReferenceFiles());
  fresh.authorize('/studio');
  assert.equal((await fresh.load('/studio'))[0].text, '');
  assert.deepEqual(await readdir(files), []);
  assert.equal(await readFile(source, 'utf8'), 'keep');
});
