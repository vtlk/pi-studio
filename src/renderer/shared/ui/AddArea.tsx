import { Plus } from 'lucide-react';
import { Tooltip } from './Tooltip';

export function AddArea({
  label,
  onClick,
  className = '',
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        className={`add-area ${className}`}
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
      >
        <Plus size={26} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
