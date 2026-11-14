import { Plus } from 'lucide-react';
import { Tooltip } from './Tooltip';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useRef } from 'react';

export function AddArea({
  label,
  onClick,
  className = '',
  disabled = false,
  showLabel = false,
  actions,
}: {
  label: string;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
  showLabel?: boolean;
  actions?: { label: string; onSelect: () => void }[];
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const pending = useRef<(() => void) | undefined>(undefined);
  const button = (
    <button
      ref={trigger}
      type="button"
      className={`add-area ${className}`}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Plus size={26} aria-hidden="true" />
      {showLabel && <span>{label}</span>}
    </button>
  );
  if (actions?.length)
    return (
      <DropdownMenu.Root modal={false}>
        <Tooltip label={label}>
          <DropdownMenu.Trigger asChild>{button}</DropdownMenu.Trigger>
        </Tooltip>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="ui-action-menu"
            sideOffset={5}
            collisionPadding={8}
            onCloseAutoFocus={(event) => {
              const action = pending.current;
              if (!action) return;
              event.preventDefault();
              pending.current = undefined;
              trigger.current?.focus();
              action();
            }}
          >
            {actions.map((action) => (
              <DropdownMenu.Item
                key={action.label}
                className="ui-action-menu-item"
                onSelect={() => {
                  pending.current = action.onSelect;
                }}
              >
                {action.label}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    );
  return showLabel ? button : <Tooltip label={label}>{button}</Tooltip>;
}
