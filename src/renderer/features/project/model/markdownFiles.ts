import type { OutputFile } from '../../../../shared/project.ts';
import { isSharedTaskPath } from '../../../../shared/agentPaths.ts';
import { resolveOutputReference } from '../../../../shared/outputPaths.ts';

export interface MarkdownFiles {
  projectId: string;
  path: string;
  files: readonly OutputFile[];
  onSelect: (id: string) => void;
}

/** Markdown URLs are relative to this document, bounded by the same agent's output. */
export function markdownFile(context: MarkdownFiles, reference: string): OutputFile | undefined {
  const match = /^agents\/([a-zA-Z0-9_-]+)\/output\/(.+)$/.exec(context.path);
  if (!match && !isSharedTaskPath(context.path)) return;
  let path: string;
  try {
    path = decodeURIComponent(reference.split(/[?#]/, 1)[0]);
  } catch {
    return;
  }
  const relative = resolveOutputReference(
    (match?.[2] ?? context.path).split('/').slice(0, -1),
    path,
  );
  if (!relative || (!match && !isSharedTaskPath(relative))) return;
  const resolved = match ? `agents/${match[1]}/output/${relative}` : relative;
  return context.files.find((file) => file.diskPath === resolved);
}
