import type { OutputFile } from './workspace.types';

// Montage is supplied by the validated editor integration, never inferred from a filename alone.
export type PreviewKind = OutputFile['format'] | 'montage';

export function getPreviewKind(file: OutputFile): OutputFile['format'] {
  return file.format === 'text' && /\.(md|markdown)$/i.test(file.name) ? 'markdown' : file.format;
}

export function getPreviewCapabilities(kind: PreviewKind) {
  return { revealInFinder: kind !== 'montage' };
}
