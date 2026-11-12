import { useRef, type ReactNode } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown } from 'lucide-react';
import { Button } from './index';
import { Tooltip } from './Tooltip';

interface SplitButtonProps {
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  onClick: () => void;
  menuLabel: string;
  actions: { label: string; onSelect: () => void }[];
}

export function SplitButton({
  label,
  icon,
  disabled,
  onClick,
  menuLabel,
  actions,
}: SplitButtonProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pendingAction = useRef<(() => void) | null>(null);
  return (
    <DropdownMenu.Root modal={false}>
      <div className="split-button" role="group" aria-label={label}>
        <Button kind="primary" disabled={disabled} onClick={onClick}>
          {icon}
          {label}
        </Button>
        <Tooltip label={menuLabel}>
          <DropdownMenu.Trigger
            ref={triggerRef}
            className="button primary split-button-trigger"
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
