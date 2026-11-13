import { useRef, type ReactNode } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown } from 'lucide-react';
import { Button } from './index';
import { Tooltip } from './Tooltip';

interface SplitButtonProps {
  label: string;
  icon?: ReactNode;
  iconOnly?: boolean;
  kind?: 'primary' | 'secondary';
  disabled?: boolean;
  onClick: () => void;
  menuLabel: string;
  actions: { label: string; onSelect: () => void }[];
}

export function SplitButton({
  label,
  icon,
  iconOnly = false,
  kind = 'primary',
  disabled,
  onClick,
  menuLabel,
  actions,
}: SplitButtonProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pendingAction = useRef<(() => void) | null>(null);
  return (
    <DropdownMenu.Root modal={false}>
      <div
        className={`split-button${iconOnly ? ' split-button-icon-only' : ''}`}
        role="group"
        aria-label={label}
      >
        {iconOnly ? (
          <Tooltip label={label}>
            <button
              type="button"
              className={`button ${kind} split-button-main`}
              disabled={disabled}
              onClick={onClick}
              aria-label={label}
            >
              {icon}
            </button>
          </Tooltip>
        ) : (
          <Button kind={kind} disabled={disabled} onClick={onClick}>
            {icon}
            {label}
          </Button>
        )}
        <Tooltip label={menuLabel}>
          <DropdownMenu.Trigger
            ref={triggerRef}
            className={`button ${kind} split-button-trigger`}
            aria-label={menuLabel}
            disabled={disabled}
          >
            <ChevronDown size={17} aria-hidden="true" />
          </DropdownMenu.Trigger>
        </Tooltip>
      </div>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="ui-action-menu"
          align="end"
          sideOffset={5}
          collisionPadding={8}
          onCloseAutoFocus={(event) => {
            const action = pendingAction.current;
            if (!action) return;
            event.preventDefault();
            pendingAction.current = null;
            triggerRef.current?.focus();
            action();
          }}
        >
          {actions.map((action) => (
            <DropdownMenu.Item
              className="ui-action-menu-item"
              key={action.label}
              onSelect={() => {
                pendingAction.current = action.onSelect;
              }}
            >
              {action.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
