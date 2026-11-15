import { useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { FindBar } from './FindBar';
import { literalMatches, isFindShortcut, type TextMatch } from './literalSearch';

type Match = TextMatch;
function reveal(textarea: HTMLTextAreaElement, match: Match) {
  textarea.setSelectionRange(match.start, match.end);
}
export const textareaMatches = literalMatches;

export function useTextareaFind(field: RefObject<HTMLTextAreaElement | null>, value: unknown) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ text: string; matches: Match[]; index: number }>({
    text: '',
    matches: [],
    index: -1,
  });
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  useLayoutEffect(() => {
    if (!open) return;
    input.current?.focus({ preventScroll: true });
    input.current?.scrollIntoView({ block: 'nearest' });
    input.current?.select();
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !field.current || composing.current) return;
    const text = field.current.value;
    const matches = textareaMatches(text, query);
    const at = matches.findIndex((match) => match.start >= field.current!.selectionStart);
    const index = matches.length ? Math.max(0, at) : -1;
    setResult({ text, matches, index });
    if (index >= 0 && document.activeElement !== field.current)
      reveal(field.current, matches[index]);
    if (document.activeElement === input.current)
      input.current?.scrollIntoView({ block: 'nearest' });
  }, [field, open, query, value, revision]);
  const close = () => {
    setOpen(false);
    field.current?.focus({ preventScroll: true });
  };
  const move = (direction: number) => {
    if (!result.matches.length) return;
    const index = (result.index + direction + result.matches.length) % result.matches.length;
    setResult({ ...result, index });
    reveal(field.current!, result.matches[index]);
    input.current?.focus({ preventScroll: true });
    input.current?.scrollIntoView({ block: 'nearest' });
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const isMac = navigator.platform.toLowerCase().includes('mac');
    if (isFindShortcut(event, isMac)) {
      event.preventDefault();
      event.stopPropagation();
      const textarea = field.current!;
      const selected = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
      if (selected && !selected.includes('\n')) setQuery(selected);
      setOpen(true);
      setRevision((current) => current + 1);
      input.current?.focus({ preventScroll: true });
      input.current?.scrollIntoView({ block: 'nearest' });
      input.current?.select();
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };
  return {
    open,
    query,
    setQuery,
    result,
    input,
    composing,
    close,
    move,
    onKeyDown,
    changed: () => setRevision((current) => current + 1),
  };
}

export function TextareaFind({ find }: { find: ReturnType<typeof useTextareaFind> }) {
  return (
    <FindBar
      input={find.input}
      query={find.query}
      onQueryChange={find.setQuery}
      count={find.result.matches.length}
      index={find.result.index}
      onMove={find.move}
      onClose={find.close}
      label="Поиск в поле"
      inputLabel="Найти в поле"
      className="textarea-findbar"
      onCompositionChange={(value) => {
        find.composing.current = value;
        if (!value) find.changed();
      }}
    />
  );
}
