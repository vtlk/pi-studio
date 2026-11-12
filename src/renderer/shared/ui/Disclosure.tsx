import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export function Disclosure({
  label,
  children,
  defaultOpen = false,
  leading,
  actions,
}: {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
  leading?: ReactNode;
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  return (
    <section className="disclosure">
      <div className="disclosure-heading">
        {leading}
        <button
          type="button"
          className="disclosure-trigger"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen((value) => !value)}
        >
          <span>{label}</span>
          <ChevronDown size={18} aria-hidden="true" />
        </button>
        {actions}
      </div>
      <div className="disclosure-content" id={contentId} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
