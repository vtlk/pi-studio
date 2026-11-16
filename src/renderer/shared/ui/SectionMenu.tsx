import { uiText } from '@/shared/model/UiText';
import { i18n } from '../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { HoverDeleteButton } from './HoverDeleteButton';
import { Tooltip } from './Tooltip';
import { useState, type ReactNode } from 'react';

interface MenuItem<T> {
  id: T;
  label: string;
  icon?: ReactNode;
  description?: ReactNode;
  ariaLabel?: string;
  iconTooltip?: string;
  suffix?: ReactNode;
  actions?: ReactNode;
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
  useTranslation(undefined, { i18n });
  const [focused, setFocused] = useState<T | null>(null);
  const [iconFocused, setIconFocused] = useState<T | null>(null);
  return (
    <nav className="section-menu" aria-label={label}>
      {leading}
      {items.map((item) => {
        const control = (
          <button
            className={`section-menu-item${selected === item.id ? ' active' : ''}`}
            aria-current={selected === item.id ? 'true' : undefined}
            aria-label={item.ariaLabel}
            data-muted={item.muted || undefined}
            onClick={() => {
              setFocused(null);
              onSelect(item.id);
            }}
            onFocus={(event) => {
              setFocused(item.id);
              setIconFocused(event.currentTarget.matches(':focus-visible') ? item.id : null);
            }}
            onBlur={() => {
              setFocused(null);
              setIconFocused(null);
            }}
            onPointerDown={() => setIconFocused(null)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setFocused(null);
                setIconFocused(null);
              }
            }}
          >
            {item.iconTooltip ? (
              <Tooltip label={item.iconTooltip} open={iconFocused === item.id || undefined}>
                <span className="section-menu-icon-anchor">{item.icon}</span>
              </Tooltip>
            ) : (
              item.icon
            )}
            <span className="section-menu-text">
              <Tooltip
                label={item.label}
                onlyWhenTruncated
                open={
                  item.iconTooltip && iconFocused === item.id
                    ? false
                    : focused === item.id || undefined
                }
              >
                <span className="section-menu-label">{item.label}</span>
              </Tooltip>
              {item.description && (
                <span className="section-menu-description">{item.description}</span>
              )}
            </span>
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
            {item.actions}
            {item.onRemove && (
              <HoverDeleteButton
                label={uiText('SectionMenu.delete', { value1: item.label })}
                onDelete={item.onRemove}
              />
            )}
          </div>
        );
      })}
      {children}
    </nav>
  );
}
