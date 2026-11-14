import assert from 'node:assert/strict';
import test from 'node:test';
import {
  markdownFile,
  type MarkdownFiles,
} from '../src/renderer/features/project/model/markdownFiles.ts';
import { outputMediaUrl } from '../src/shared/outputPaths.ts';
import type { OutputFile } from '../src/shared/project.ts';

const image: OutputFile = {
  id: 'image',
  kind: 'file',
  name: 'кадр #1.png',
  format: 'image',
  diskPath: 'agents/story/output/assets/кадр #1.png',
  fingerprint: '20:100',
};
const text: OutputFile = {
  id: 'text',
  kind: 'file',
  name: 'notes.txt',
  format: 'text',
  diskPath: 'agents/story/output/notes.txt',
};
const context: MarkdownFiles = {
  projectId: 'project',
  path: 'agents/story/output/docs/story.md',
  files: [image, text],
  onSelect: () => {},
};
test('Markdown resolves encoded local references from the document folder and uses current file metadata', () => {
  assert.equal(markdownFile(context, '../assets/%D0%BA%D0%B0%D0%B4%D1%80%20%231.png?old=1'), image);
  assert.equal(markdownFile(context, '../notes.txt#section'), text);
  assert.equal(
    markdownFile({ ...context, path: 'agents/story/output/story.md' }, 'notes.txt'),
    text,
  );
  assert.equal(
    outputMediaUrl(context.projectId, image.diskPath!, image.fingerprint),
    'studio-media://output/project/agents/story/output/assets/%D0%BA%D0%B0%D0%B4%D1%80%20%231.png?v=20%3A100',
  );
});
test('Markdown never resolves outside the bound output, remote schemes, missing entries or malformed URLs', () => {
  for (const reference of [
    '../../notes.txt',
    '../../../other/output/notes.txt',
    '/notes.txt',
    'file:///etc/passwd',
    'https://example.org/image.png',
    '//example.org/a.png',
    'data:image/png;base64,AAAA',
    'javascript:alert(1)',
    '../%00notes.txt',
    '..%5cnotes.txt',
    '%',
    '../missing.png',
    '#section',
  ])
    assert.equal(markdownFile(context, reference), undefined, reference);
  assert.equal(markdownFile({ ...context, path: 'project.json' }, 'notes.txt'), undefined);
});
