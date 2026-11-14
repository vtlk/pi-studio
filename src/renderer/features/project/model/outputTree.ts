import type { OutputEntry, OutputFile } from './workspace.types';
import { compareOutputEntries } from '../../../../shared/outputOrder.ts';

export function sortOutputEntries(entries: OutputEntry[]): OutputEntry[] {
  return [...entries].sort(compareOutputEntries);
}

export function countFiles(entries: OutputEntry[]): number {
  return entries.reduce(
    (count, entry) => count + (entry.kind === 'file' ? 1 : countFiles(entry.children)),
    0,
  );
}
export function listOutputFiles(
  entries: OutputEntry[],
  parents: string[] = [],
): { file: OutputFile; path: string[] }[] {
  return sortOutputEntries(entries).flatMap((entry) =>
    entry.kind === 'file'
      ? [{ file: entry, path: [...parents, entry.name] }]
      : listOutputFiles(entry.children, [...parents, entry.name]),
  );
}
