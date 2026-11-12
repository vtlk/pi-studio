import assert from 'node:assert/strict';
import test from 'node:test';
import {
  sortOutputEntries,
  listOutputFiles,
} from '../src/renderer/features/project/model/outputTree.ts';
import type { OutputEntry } from '../src/renderer/features/project/model/workspace.types.ts';

test('files and folders share oldest-first creation order without mutating the source', () => {
  const entries: OutputEntry[] = [
    { kind: 'file', id: 'new', name: 'new.txt', format: 'text', createdAt: 30 },
    { kind: 'folder', id: 'old-folder', name: 'Сцена 1', createdAt: 10, children: [] },
    { kind: 'file', id: 'middle', name: 'middle.txt', format: 'text', createdAt: 20 },
  ];
  assert.deepEqual(
    sortOutputEntries(entries).map((entry) => entry.id),
    ['old-folder', 'middle', 'new'],
  );
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ['new', 'old-folder', 'middle'],
  );
});

test('nested preview indexing follows the tree creation order and retains the full relative path', () => {
  const entries: OutputEntry[] = [
    { kind: 'file', id: 'last', name: 'last.txt', format: 'text', createdAt: 30 },
    {
      kind: 'folder',
      id: 'scene',
      name: 'Сцена 1',
      createdAt: 10,
      children: [
        { kind: 'file', id: 'later', name: 'scene.svg', format: 'image', createdAt: 20 },
        { kind: 'file', id: 'first', name: 'reference.png', format: 'image', createdAt: 10 },
      ],
    },
  ];
  const files = listOutputFiles(entries);
  assert.deepEqual(
    files.map(({ file }) => file.id),
    ['first', 'later', 'last'],
  );
  assert.deepEqual(files[0].path, ['Сцена 1', 'reference.png']);
});
