import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { FindBar } from '@/shared/ui/FindBar';
import { isFindShortcut } from '@/shared/ui/literalSearch';
import { previewRanges, revealPreviewRange } from '../model/previewSearch';

export function SearchablePreview({
  children,
  enabled,
  ready,
  empty,
  documentKey,
}: {
  children: ReactNode;
  enabled: boolean;
  ready: boolean;
  empty: boolean;
  documentKey: string;
}) {
  useTranslation(undefined, { i18n });
  const content = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [ranges, setRanges] = useState<Range[]>([]);
  const [index, setIndex] = useState(-1);
  const visible = enabled && open;
  const close = useCallback(() => {
    setOpen(false);
    const previous = previousFocus.current;
    (previous?.isConnected ? previous : content.current)?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const keyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector('[role="dialog"],[role="alertdialog"]'))
        return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('textarea,input,[contenteditable="true"]') && target !== input.current)
        return;
      if (isFindShortcut(event, navigator.platform.toLowerCase().includes('mac'))) {
        event.preventDefault();
        event.stopPropagation();
        if (!open)
          previousFocus.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const selection = window.getSelection();
        if (
          selection?.rangeCount &&
          content.current?.contains(selection.getRangeAt(0).commonAncestorContainer)
        ) {
          const selected = selection.toString();
          if (selected && !selected.includes('\n')) setQuery(selected);
        }
        setOpen(true);
        input.current?.focus({ preventScroll: true });
        input.current?.select();
      } else if (event.key === 'Escape' && open) {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', keyDown);
    return () => window.removeEventListener('keydown', keyDown);
  }, [enabled, open, close]);
  useLayoutEffect(() => {
    if (!visible) return;
    input.current?.focus({ preventScroll: true });
    input.current?.select();
  }, [visible]);
  useLayoutEffect(() => {
    const element = content.current!;
    const update = () => {
      setRanges(visible && ready && !empty ? previewRanges(element, query) : []);
      setIndex(visible && ready && !empty && query ? 0 : -1);
    };
    update();
    if (!visible || !ready || empty) return;
    const observer = new MutationObserver(update);
    observer.observe(element, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [visible, ready, empty, documentKey, query]);
  const current = ranges.length ? Math.min(Math.max(index, 0), ranges.length - 1) : -1;
  useLayoutEffect(() => {
    if (!visible) return;
    const all = new Highlight(...ranges);
    const active = new Highlight(...(current >= 0 ? [ranges[current]] : []));
    active.priority = 1;
    CSS.highlights.set('pistudio-preview-matches', all);
    CSS.highlights.set('pistudio-preview-current', active);
    if (current >= 0) revealPreviewRange(content.current!, ranges[current]);
    return () => {
      if (CSS.highlights.get('pistudio-preview-matches') === all)
        CSS.highlights.delete('pistudio-preview-matches');
      if (CSS.highlights.get('pistudio-preview-current') === active)
        CSS.highlights.delete('pistudio-preview-current');
    };
  }, [visible, ranges, current]);
  return (
    <div className="searchable-preview">
      {visible && (
        <FindBar
          input={input}
          query={query}
          onQueryChange={setQuery}
          count={ranges.length}
          index={current}
          onMove={(direction) => {
            if (ranges.length) setIndex((current + direction + ranges.length) % ranges.length);
            input.current?.focus({ preventScroll: true });
          }}
          onClose={close}
          label={t('SearchablePreview.searchPreview')}
          inputLabel={t('SearchablePreview.findInFile')}
          className="preview-findbar"
        />
      )}
      <div
        ref={content}
        className="output-browser-content"
        role="region"
        aria-label={t('SearchablePreview.filePreview')}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
