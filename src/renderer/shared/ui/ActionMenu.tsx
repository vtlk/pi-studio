import { useControlScope } from './ControlScope.context';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Fragment, useRef, useState } from 'react';
import { Ellipsis, type LucideIcon } from 'lucide-react';
import { Tooltip } from './Tooltip';
export function ActionMenu({
  label,
  className = '',
  disabled,
  actions,
}: {
  label: string;
  className?: string;
  disabled?: boolean;
  actions: {
    label: string;
    icon?: LucideIcon;
    onSelect: () => void;
    disabled?: boolean;
    separator?: boolean;
    danger?: boolean;
  }[];
}) {
  const controlsScope = useControlScope();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null),
    pending = useRef<(() => void) | null>(null);
  return (
    <DropdownMenu.Root modal={false} open={open} onOpenChange={setOpen}>
      <Tooltip label={label}>
        <DropdownMenu.Trigger
          ref={trigger}
          className={`icon-button ${className}`}
          aria-label={label}
          disabled={disabled}
        >
          <Ellipsis size={18} aria-hidden="true" />
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="ui-action-menu"
          data-controls-scope={controlsScope}
          align="end"
          sideOffset={5}
          collisionPadding={8}
          onCloseAutoFocus={(event) => {
            const action = pending.current;
            if (!action) return;
            event.preventDefault();
            pending.current = null;
            trigger.current?.focus({ preventScroll: true });
            action();
          }}
        >
          {actions.map((action) => (
            <Fragment key={action.label}>
              {action.separator && <DropdownMenu.Separator className="ui-action-menu-separator" />}
              <DropdownMenu.Item
                className={`ui-action-menu-item${action.danger ? ' danger' : ''}`}
                disabled={action.disabled}
                onSelect={() => {
                  pending.current = action.onSelect;
                }}
              >
                {action.icon && <action.icon size={16} aria-hidden="true" />}
                {action.label}
              </DropdownMenu.Item>
            </Fragment>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
