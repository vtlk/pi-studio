import assert from 'node:assert/strict';
import test from 'node:test';
import { fileFormat } from '../src/main/storage/outputs.ts';
import { codeLanguage } from '../src/shared/codeLanguage.ts';

test('native output discovery admits source files without changing existing media/Markdown formats', () => {
  for (const name of [
    'worker.PY',
    'index.js',
    'component.jsx',
    'main.tsx',
    'main.rs',
    'main.go',
    'style.scss',
    'program.cpp',
    'Dockerfile',
    'install.ps1',
  ])
    assert.equal(fileFormat(name), 'text', name);
  for (const [name, format] of [
    ['animated.svg', 'image'],
    ['film.mp4', 'video'],
    ['music.mp3', 'audio'],
    ['notes.md', 'markdown'],
    ['data.json', 'json'],
    ['binary.exe', 'unsupported'],
  ])
    assert.equal(fileFormat(name), format, name);
});
test('source preview selects languages case-insensitively and accepts filenames, without running code', () => {
  assert.equal(codeLanguage('MAIN.JS'), 'javascript');
  assert.equal(codeLanguage('worker.PY'), 'python');
  assert.equal(codeLanguage('Dockerfile'), 'dockerfile');
  assert.equal(codeLanguage('notes.txt'), undefined);
});
