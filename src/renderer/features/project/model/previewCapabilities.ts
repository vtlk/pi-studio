import type { OutputFile } from './workspace.types';

export function getPreviewKind(file: OutputFile): OutputFile['format'] | 'html' {
  if (/\.html?$/i.test(file.name) && file.format === 'text') return 'html';
  return file.format === 'text' && /\.(md|markdown)$/i.test(file.name) ? 'markdown' : file.format;
}
