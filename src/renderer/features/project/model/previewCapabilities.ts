import { codeLanguage } from '../../../../shared/codeLanguage.ts';
import type { OutputFile } from './workspace.types';

export function getPreviewKind(file: OutputFile): OutputFile['format'] | 'html' | 'code' {
  if (/\.html?$/i.test(file.name) && file.format === 'text') return 'html';
  if (['text', 'json'].includes(file.format) && codeLanguage(file.name)) return 'code';
  return file.format === 'text' && /\.(md|markdown)$/i.test(file.name) ? 'markdown' : file.format;
}
