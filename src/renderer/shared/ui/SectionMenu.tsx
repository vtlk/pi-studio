import { HoverDeleteButton } from './HoverDeleteButton';
import { Tooltip } from './Tooltip';
import { useState, type ReactNode } from 'react';

interface MenuItem<T> {
  id: T;
  label: string;
  suffix?: ReactNode;
  onRemove?: () => void;
  muted?: boolean;
}
interface SectionMenuProps<T> {
  items: MenuItem<T>[];
  selected: T;
  onSelect: (id: T) => void;
  label: string;
  children?: ReactNode;
  leading?: ReactNode;
}

export function SectionMenu<T extends string | number>({
  items,
  selected,
  onSelect,
  label,
  children,
  leading,
}: SectionMenuProps<T>) {
  const [focused, setFocused] = useState<T | null>(null);
  return (
    <nav className="section-menu" aria-label={label}>
      {leading}
      {items.map((item) => {
        const control = (
          <button
            className={`section-menu-item${selected === item.id ? ' active' : ''}`}
            aria-current={selected === item.id ? 'true' : undefined}
            data-muted={item.muted || undefined}
            onClick={() => {
              setFocused(null);
              onSelect(item.id);
            }}
            onFocus={() => setFocused(item.id)}
            onBlur={() => setFocused(null)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setFocused(null);
            }}
          >
            <Tooltip label={item.label} onlyWhenTruncated open={focused === item.id || undefined}>
              <span>{item.label}</span>
            </Tooltip>
            {item.suffix}
          </button>
        );
        return (
          <div
            className="section-menu-row"
            key={item.id}
            data-removable={item.onRemove ? true : undefined}
          >
            {control}
            {item.onRemove && (
              <HoverDeleteButton label={`Удалить ${item.label}`} onDelete={item.onRemove} />
            )}
          </div>
        );
      })}
      {children}
    </nav>
  );
}
