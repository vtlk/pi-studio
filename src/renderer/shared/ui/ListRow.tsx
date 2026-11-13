import { useRef, type ComponentProps, type ReactNode } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import { Switch } from './SelectionControls';
import { Tooltip } from './Tooltip';
import './list.css';

export function List({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`ui-list ${className}`}>{children}</div>;
}

export interface ListRowProps {
  label: string;
  icon?: LucideIcon;
  toggle?: ComponentProps<typeof Switch>;
  dragHandle?: ReactNode;
  actions?: ReactNode;
  onClick?: () => void;
  expanded?: boolean;
  controls?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}

/** One row layout for plain lists and disclosures. Interactive controls are always siblings. */
export function ListRow({
  label,
  icon: Icon,
  toggle,
  dragHandle,
  actions,
  onClick,
  expanded,
  controls,
  id,
  disabled = false,
  className = '',
}: ListRowProps) {
  const trigger = useRef<HTMLButtonElement>(null);
  const content = (
    <>
      {Icon && <Icon className="ui-list-row-icon" size={20} strokeWidth={1.8} aria-hidden="true" />}
      <span className="ui-list-row-label">{label}</span>
      {expanded !== undefined && (
        <ChevronDown className="ui-list-row-chevron" size={18} aria-hidden="true" />
      )}
    </>
  );
  return (
    <div
      className={`ui-list-row ${className}`}
      data-expanded={expanded}
      data-clickable={!!onClick}
      data-disabled={disabled || undefined}
      onClick={(event) => {
        if (event.target === event.currentTarget && !disabled) {
          trigger.current?.focus({ preventScroll: true });
          onClick?.();
        }
      }}
    >
      {dragHandle && <div className="ui-list-row-drag">{dragHandle}</div>}
      <Tooltip label={label} onlyWhenTruncated overflowSelector=".ui-list-row-label">
        {onClick ? (
          <button
            type="button"
            ref={trigger}
            id={id}
            className={`ui-list-row-main${expanded !== undefined ? ' disclosure-trigger' : ''}`}
            aria-expanded={expanded}
            aria-controls={controls}
            onClick={onClick}
            disabled={disabled}
          >
            {content}
          </button>
        ) : (
          <div className="ui-list-row-main" id={id}>
            {content}
          </div>
        )}
      </Tooltip>
      {toggle && (
        <div className="ui-list-row-toggle">
          <Switch {...toggle} />
        </div>
      )}
      {actions && <div className="ui-list-row-actions">{actions}</div>}
    </div>
  );
}
