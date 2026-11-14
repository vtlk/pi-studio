import assert from 'node:assert/strict';
import test from 'node:test';
import {
  sortOutputEntries,
  listOutputFiles,
} from '../src/renderer/features/project/model/outputTree.ts';
import type { OutputEntry } from '../src/renderer/features/project/model/workspace.types.ts';

test('folders precede files, keeping oldest-first order within both groups without mutation', () => {
  const entries: OutputEntry[] = [
    { kind: 'file', id: 'new', name: 'new.txt', format: 'text', createdAt: 30 },
    { kind: 'folder', id: 'new-folder', name: 'Сцена 2', createdAt: 40, children: [] },
    { kind: 'file', id: 'middle', name: 'middle.txt', format: 'text', createdAt: 20 },
    { kind: 'folder', id: 'old-folder', name: 'Сцена 1', createdAt: 35, children: [] },
  ];
  assert.deepEqual(
    sortOutputEntries(entries).map((entry) => entry.id),
    ['old-folder', 'new-folder', 'middle', 'new'],
  );
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ['new', 'new-folder', 'middle', 'old-folder'],
  );
});

test('nested preview indexing keeps folders first at every level and retains the full path', () => {
  const entries: OutputEntry[] = [
    { kind: 'file', id: 'last', name: 'last.txt', format: 'text', createdAt: 30 },
    {
      kind: 'folder',
      id: 'scene',
      name: 'Сцена 1',
      createdAt: 40,
      children: [
        {
          kind: 'folder',
          id: 'nested',
          name: 'Подпапка',
          createdAt: 60,
          children: [
            { kind: 'file', id: 'inside', name: 'nested.txt', format: 'text', createdAt: 70 },
          ],
        },
        { kind: 'file', id: 'later', name: 'scene.svg', format: 'image', createdAt: 20 },
        { kind: 'file', id: 'first', name: 'reference.png', format: 'image', createdAt: 10 },
      ],
    },
  ];
  const files = listOutputFiles(entries);
  assert.deepEqual(
    files.map(({ file }) => file.id),
    ['inside', 'first', 'later', 'last'],
  );
  assert.deepEqual(files[0].path, ['Сцена 1', 'Подпапка', 'nested.txt']);
  assert.deepEqual(files[1].path, ['Сцена 1', 'reference.png']);
});
