import type { OutputFile } from './workspace.types';

export function getPreviewKind(file: OutputFile): OutputFile['format'] {
  return file.format === 'text' && /\.(md|markdown)$/i.test(file.name) ? 'markdown' : file.format;
}
