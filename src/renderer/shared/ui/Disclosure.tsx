import { useId, useState, type ReactNode } from 'react';
import { ListRow, type ListRowProps } from './ListRow';
export { List as DisclosureList } from './ListRow';

export function Disclosure({
  label,
  children,
  defaultOpen = false,
  icon,
  toggle,
  dragHandle,
  actions,
}: {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
  icon?: ListRowProps['icon'];
  toggle?: ListRowProps['toggle'];
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
        dragHandle={dragHandle}
        actions={actions}
        id={triggerId}
        expanded={open}
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
