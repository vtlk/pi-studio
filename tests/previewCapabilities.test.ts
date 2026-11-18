import assert from 'node:assert/strict';
import test from 'node:test';
import { getPreviewKind } from '../src/renderer/features/project/model/previewCapabilities.ts';
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
test('ordinary JSON, including legacy manifest names, stays a searchable text document', () => {
  assert.equal(getPreviewKind(file('movie.pistudio.json', 'json')), 'json');
});

test('HTML and HTM text files use the inert HTML preview while other formats stay unchanged', () => {
  assert.equal(getPreviewKind(file('page.HTML')), 'html');
  assert.equal(getPreviewKind(file('page.htm')), 'html');
  assert.equal(getPreviewKind(file('page.html.txt')), 'text');
  assert.equal(getPreviewKind(file('page.html', 'unsupported')), 'unsupported');
});
