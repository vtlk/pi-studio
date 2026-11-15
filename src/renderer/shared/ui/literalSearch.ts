export type TextMatch = { start: number; end: number };

/** Unicode case-insensitive literal matching, with original UTF-16 DOM offsets. */
export function literalMatches(value: string, query: string): TextMatch[] {
  if (!query) return [];
  const literal = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...value.matchAll(new RegExp(literal, 'giu'))].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

export function isFindShortcut(
  event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'code' | 'key'>,
  isMac: boolean,
) {
  return (
    !event.altKey &&
    !event.shiftKey &&
    ((event.metaKey && !event.ctrlKey) || (!isMac && event.ctrlKey && !event.metaKey)) &&
    (event.code === 'KeyF' || event.key.toLowerCase() === 'f')
  );
}
