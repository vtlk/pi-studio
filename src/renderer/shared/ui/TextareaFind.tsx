import { useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { ArrowDown, ArrowUp, Search, X } from 'lucide-react';
import { IconButton } from './index';

type Match = { start: number; end: number };
function reveal(textarea: HTMLTextAreaElement, match: Match) {
  textarea.setSelectionRange(match.start, match.end);
}
export function textareaMatches(value: string, query: string): Match[] {
  if (!query) return [];
  const literal = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...value.matchAll(new RegExp(literal, 'giu'))].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

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
    const command =
      (event.metaKey && !event.ctrlKey) || (!isMac && event.ctrlKey && !event.metaKey);
    if (
      command &&
      !event.altKey &&
      !event.shiftKey &&
      (event.code === 'KeyF' || event.key.toLowerCase() === 'f')
    ) {
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
    <div className="textarea-findbar" role="search" aria-label="Поиск в поле">
      <Search size={16} aria-hidden="true" />
      <input
        ref={find.input}
        type="search"
        aria-label="Найти в поле"
        placeholder="Найти в поле"
        value={find.query}
        autoComplete="off"
        spellCheck={false}
        onCompositionStart={() => {
          find.composing.current = true;
        }}
        onCompositionEnd={() => {
          find.composing.current = false;
          find.changed();
        }}
        onChange={(event) => find.setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            find.move(event.shiftKey ? -1 : 1);
          }
        }}
      />
      <span className="textarea-find-count" role="status" aria-live="polite">
        {find.result.index + 1} / {find.result.matches.length}
      </span>
      <IconButton
        title="Предыдущее совпадение"
        disabled={!find.result.matches.length}
        onClick={() => find.move(-1)}
      >
        <ArrowUp size={16} />
      </IconButton>
      <IconButton
        title="Следующее совпадение"
        disabled={!find.result.matches.length}
        onClick={() => find.move(1)}
      >
        <ArrowDown size={16} />
      </IconButton>
      <IconButton title="Закрыть поиск" onClick={find.close}>
        <X size={16} />
      </IconButton>
    </div>
  );
}
