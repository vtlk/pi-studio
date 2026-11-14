import type { OutputEntry } from './project.ts';

/** Folders first; within each group keep the oldest-created entries first. */
export function compareOutputEntries(a: OutputEntry, b: OutputEntry): number {
  if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
  return (
    (a.createdAt ?? 0) - (b.createdAt ?? 0) ||
    a.name.localeCompare(b.name, 'ru', { numeric: true }) ||
    a.id.localeCompare(b.id)
  );
}
