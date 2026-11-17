import { useId, useState, type ReactNode } from 'react';
import { ListRow, type ListRowProps } from './ListRow';
export { List as DisclosureList } from './ListRow';

export function Disclosure({
  label,
  children,
  defaultOpen = false,
  chevronPosition,
  separator,
  icon,
  toggle,
  locked,
  reserveActions,
  dragHandle,
  actions,
}: {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
  chevronPosition?: ListRowProps['chevronPosition'];
  separator?: ListRowProps['separator'];
  icon?: ListRowProps['icon'];
  toggle?: ListRowProps['toggle'];
  locked?: ListRowProps['locked'];
  reserveActions?: ListRowProps['reserveActions'];
  dragHandle?: ReactNode;
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  const triggerId = useId();
  return (
    <section className="disclosure">
      <ListRow
        className="disclosure-heading"
        label={label}
        icon={icon}
        toggle={toggle}
        locked={locked}
        reserveActions={reserveActions}
        dragHandle={dragHandle}
        actions={actions}
        id={triggerId}
        expanded={open}
        chevronPosition={chevronPosition}
        separator={separator}
        controls={contentId}
        onClick={() => setOpen((value) => !value)}
      />
      <div
        className="disclosure-content"
        role="region"
        aria-labelledby={triggerId}
        id={contentId}
        hidden={!open}
      >
        {children}
      </div>
    </section>
  );
}
