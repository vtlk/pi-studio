import { t, i18n } from '../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import type { RefObject } from 'react';
import { ArrowDown, ArrowUp, Search, X } from 'lucide-react';
import { IconButton } from './index';

export function FindBar({
  input,
  query,
  onQueryChange,
  count,
  index,
  onMove,
  onClose,
  label,
  inputLabel,
  className,
  onCompositionChange,
}: {
  input: RefObject<HTMLInputElement | null>;
  query: string;
  onQueryChange: (value: string) => void;
  count: number;
  index: number;
  onMove: (direction: number) => void;
  onClose: () => void;
  label: string;
  inputLabel: string;
  className?: string;
  onCompositionChange?: (value: boolean) => void;
}) {
  useTranslation(undefined, { i18n });
  return (
    <div
      className={['find-bar', className].filter(Boolean).join(' ')}
      role="search"
      aria-label={label}
    >
      <Search size={16} aria-hidden="true" />
      <input
        ref={input}
        type="search"
        aria-label={inputLabel}
        placeholder={inputLabel}
        value={query}
        autoComplete="off"
        spellCheck={false}
        onCompositionStart={() => onCompositionChange?.(true)}
        onCompositionEnd={() => onCompositionChange?.(false)}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.stopPropagation();
            onMove(event.shiftKey ? -1 : 1);
          }
        }}
      />
      <span className="textarea-find-count" role="status" aria-live="polite">
        {index + 1} / {count}
      </span>
      <IconButton title={t('FindBar.previousMatch')} disabled={!count} onClick={() => onMove(-1)}>
        <ArrowUp size={16} />
      </IconButton>
      <IconButton title={t('FindBar.nextMatch')} disabled={!count} onClick={() => onMove(1)}>
        <ArrowDown size={16} />
      </IconButton>
      <IconButton title={t('FindBar.closeSearch')} onClick={onClose}>
        <X size={16} />
      </IconButton>
    </div>
  );
}
