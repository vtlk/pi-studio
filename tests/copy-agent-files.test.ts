import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { StudioStore } from '../src/main/storage/StudioStore.ts';
import { ReferenceFiles } from '../src/main/pi/ReferenceFiles.ts';
import { copyAgentFiles } from '../src/main/storage/copyAgentFiles.ts';

test('dropping files copies into only the selected agent output, preserves sources and avoids collisions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-drop-'));
  try {
    const store = await StudioStore.open(join(root, 'studio'));
    const agent = {
      id: randomUUID(),
      name: 'Drop agent',
      enabled: true,
      skills: [],
      mcps: [],
      plugins: [],
      instructions: [],
    };
    const project = (await store.command({ kind: 'create', name: 'Drop project', agents: [agent] }))
      .projects[0];
    const directory = await store.projects.directory(project.id),
      selected = project.agents[0];
    const registry = new ReferenceFiles();
    const source = join(root, 'source.txt');
    await writeFile(source, 'source-content');
    const refs = await registry.select([source], store.folder);
    const items = registry.validate(
      refs.map((ref) => ref.id),
      store.folder,
      true,
    );
    const first = await copyAgentFiles(directory, project, selected, items);
    const second = await copyAgentFiles(directory, project, selected, items);
    assert.equal(first[0], selected.outputPath + '/source.txt');
    assert.equal(second[0], selected.outputPath + '/source (2).txt');
    assert.equal(await readFile(join(directory, second[0]), 'utf8'), 'source-content');
    assert.equal(await readFile(source, 'utf8'), 'source-content');
    const previous = await readFile(join(directory, first[0]));
    await writeFile(source, 'changed-content');
    await assert.rejects(copyAgentFiles(directory, project, selected, items), /изменился/);
    assert.deepEqual(await readFile(join(directory, first[0])), previous);
    const shared = { ...project, workspaceMode: 'shared' as const };
    await writeFile(join(root, 'project.json'), 'must-not-overwrite');
    const forbidden = await registry.select([join(root, 'project.json')], store.folder);
    await assert.rejects(
      copyAgentFiles(
        directory,
        shared,
        selected,
        registry.validate(
          forbidden.map((file) => file.id),
          store.folder,
          true,
        ),
      ),
      /Имя файла/,
    );
    assert.equal(
      JSON.parse(await readFile(join(directory, 'project.json'), 'utf8')).name,
      project.name,
    );
    if (process.platform !== 'win32') {
      const outside = join(root, 'outside');
      await mkdir(outside);
      await symlink(outside, join(directory, selected.outputPath, 'linked.txt'));
      await writeFile(join(root, 'linked.txt'), 'scoped');
      const staged = await registry.select([join(root, 'linked.txt')], store.folder);
      await assert.rejects(
        copyAgentFiles(
          directory,
          project,
          selected,
          registry.validate(
            staged.map((file) => file.id),
            store.folder,
            true,
          ),
        ),
      );
      assert.deepEqual(await readdir(outside), []);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('pasted images use private temporary files and releasing them never deletes original user files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-paste-'));
  try {
    const registry = new ReferenceFiles();
    const bytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
      'base64',
    );
    const original = join(root, 'original.png');
    await writeFile(original, bytes);
    const pasted = await registry.paste(bytes, join(root, 'private'), root);
    const [source] = await registry.select([original], root);
    const path = registry.validate([pasted.id], root, true)[0].path;
    assert.deepEqual(await readFile(path), bytes);
    registry.release([pasted.id, source.id]);
    for (let i = 0; i < 20 && (await readdir(join(root, 'private'))).length; i++)
      await new Promise((done) => setTimeout(done, 5));
    assert.deepEqual(await readdir(join(root, 'private')), []);
    assert.deepEqual(await readFile(original), bytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
