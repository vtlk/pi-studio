import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { SelectOption } from './Select';

interface SearchableSelectProps {
  label: string;
  value: string;
  options: readonly SelectOption[];
  disabled?: boolean;
  onValueChange: (value: string) => void;
}

export function SearchableSelect({
  label,
  value,
  options,
  disabled,
  onValueChange,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeValue, setActiveValue] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const filtered = options.filter((item) =>
    `${item.label} ${item.value}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const enabled = filtered.filter((item) => !item.disabled);
  const active = enabled.find((item) => item.value === activeValue) ?? enabled[0];
  const activeIndex = filtered.findIndex((item) => item.value === active?.value);
  const optionId = (index: number) => `${listId}-${index}`;
  useLayoutEffect(() => {
    if (open && activeIndex >= 0)
      document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, listId, query]);
  const choose = (next: string) => {
    onValueChange(next);
    setOpen(false);
  };
  return (
    <Popover.Root
      open={open && !disabled}
      onOpenChange={(next) => {
        setOpen(next);
        setQuery('');
        setActiveValue(value);
      }}
    >
      <Popover.Trigger className="ui-select-trigger" aria-label={label} disabled={disabled}>
        <span>{options.find((item) => item.value === value)?.label ?? 'Выберите модель'}</span>
        <ChevronDown size={17} aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="ui-searchable-select"
          sideOffset={4}
          collisionPadding={12}
          aria-label={label}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            input.current?.focus({ preventScroll: true });
          }}
        >
          <div className="ui-select-search">
            <Search size={16} aria-hidden="true" />
            <input
              ref={input}
              role="combobox"
              aria-label={`Поиск: ${label.toLocaleLowerCase()}`}
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
              placeholder="Найти модель"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveValue('');
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  const index = enabled.findIndex((item) => item.value === active?.value);
                  const next =
                    enabled[
                      (index + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) %
                        enabled.length
                    ];
                  if (next) {
                    setActiveValue(next.value);
                  }
                } else if (event.key === 'Enter' && active) {
                  event.preventDefault();
                  choose(active.value);
                }
              }}
            />
          </div>
          <div className="ui-searchable-options" id={listId} role="listbox" aria-label={label}>
            {filtered.map((item, index) => (
              <button
                type="button"
                role="option"
                id={optionId(index)}
                key={item.value}
                className="ui-select-option"
                aria-selected={value === item.value}
                data-active={active?.value === item.value || undefined}
                disabled={item.disabled}
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onPointerMove={() => !item.disabled && setActiveValue(item.value)}
                onClick={() => choose(item.value)}
              >
                <span>{item.label}</span>
                {value === item.value && (
                  <Check size={16} className="ui-select-indicator" aria-hidden="true" />
                )}
              </button>
            ))}
          </div>
          {filtered.length === 0 && (
            <p className="ui-select-empty" role="status">
              Модели не найдены
            </p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
