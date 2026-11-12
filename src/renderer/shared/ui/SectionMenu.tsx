import { HoverDeleteButton } from './HoverDeleteButton';
import { Tooltip } from './Tooltip';
import type { ReactNode } from 'react';

interface MenuItem<T> {
  id: T;
  label: string;
  suffix?: ReactNode;
  onRemove?: () => void;
  muted?: boolean;
  tooltip?: string;
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
  return (
    <nav className="section-menu" aria-label={label}>
      {leading}
      {items.map((item) => {
        const control = (
          <button
            className={`section-menu-item${selected === item.id ? ' active' : ''}`}
            aria-current={selected === item.id ? 'true' : undefined}
            data-muted={item.muted || undefined}
            onClick={() => onSelect(item.id)}
          >
            <span>{item.label}</span>
            {item.suffix}
          </button>
        );
        return (
          <div
            className="section-menu-row"
            key={item.id}
            data-removable={item.onRemove ? true : undefined}
          >
            {item.tooltip ? <Tooltip label={item.tooltip}>{control}</Tooltip> : control}
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
