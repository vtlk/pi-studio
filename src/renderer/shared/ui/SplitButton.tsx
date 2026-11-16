import { useControlScope } from './ControlScope.context';
import { useRef, useState, type ReactNode } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown } from 'lucide-react';
import { Button } from './index';
import { Tooltip } from './Tooltip';

interface SplitButtonProps {
  label: string;
  tooltipLabel?: string;
  icon?: ReactNode;
  iconOnly?: boolean;
  kind?: 'primary' | 'secondary';
  disabled?: boolean;
  busy?: boolean;
  onClick: () => void;
  menuLabel: string;
  actions: { label: string; onSelect: () => void }[];
}

export function SplitButton({
  label,
  tooltipLabel = label,
  icon,
  iconOnly = false,
  kind = 'primary',
  disabled,
  busy = false,
  onClick,
  menuLabel,
  actions,
}: SplitButtonProps) {
  const controlsScope = useControlScope();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pendingAction = useRef<(() => void) | null>(null);
  return (
    <DropdownMenu.Root modal={false} open={open} onOpenChange={setOpen}>
      <div
        className={`split-button${iconOnly ? ' split-button-icon-only' : ''}`}
        data-menu-open={open || undefined}
        data-disabled={disabled || busy || undefined}
        role="group"
        aria-label={label}
        aria-busy={busy || undefined}
      >
        {iconOnly ? (
          <Tooltip label={tooltipLabel}>
            <button
              type="button"
              className={`button ${kind} split-button-main`}
              disabled={disabled || busy}
              onClick={onClick}
              aria-label={label}
            >
              {icon}
            </button>
          </Tooltip>
        ) : (
          <Button kind={kind} disabled={disabled || busy} onClick={onClick}>
            {icon}
            {label}
          </Button>
        )}
        <Tooltip label={menuLabel}>
          <DropdownMenu.Trigger
            ref={triggerRef}
            className={`button ${kind} split-button-trigger`}
            aria-label={menuLabel}
            disabled={disabled || busy}
          >
            <ChevronDown size={17} aria-hidden="true" />
          </DropdownMenu.Trigger>
        </Tooltip>
      </div>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="ui-action-menu"
          data-controls-scope={controlsScope}
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
              disabled={disabled || busy}
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
