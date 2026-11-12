import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getPreviewCapabilities,
  getPreviewKind,
} from '../src/renderer/features/project/model/previewCapabilities.ts';
import type { OutputFile } from '../src/renderer/features/project/model/workspace.types.ts';

const file = (name: string, format: OutputFile['format'] = 'text'): OutputFile => ({
  kind: 'file',
  id: name,
  name,
  format,
  content: '',
});

test('Markdown text files select the Markdown viewer regardless of extension case', () => {
  assert.equal(getPreviewKind(file('Сценарий.MD')), 'markdown');
  assert.equal(getPreviewKind(file('notes.markdown')), 'markdown');
  assert.equal(getPreviewKind(file('notes.txt')), 'text');
});
test('ordinary file viewers allow Finder and the built-in montage viewer hides it', () => {
  for (const kind of [
    'text',
    'markdown',
    'json',
    'image',
    'audio',
    'video',
    'unsupported',
  ] as const)
    assert.equal(getPreviewCapabilities(kind).revealInFinder, true, kind);
  assert.equal(getPreviewCapabilities('montage').revealInFinder, false);
});
test('a JSON filename alone does not activate an unvalidated montage viewer', () => {
  assert.equal(getPreviewKind(file('movie.pistudio.json', 'json')), 'json');
});
