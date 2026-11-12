import { Plus } from 'lucide-react';
import { Tooltip } from './Tooltip';

export function AddArea({
  label,
  onClick,
  className = '',
}: {
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        className={`add-area ${className}`}
        aria-label={label}
        onClick={onClick}
      >
        <Plus size={26} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
