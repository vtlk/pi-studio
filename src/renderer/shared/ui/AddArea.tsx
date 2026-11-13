import { Plus } from 'lucide-react';
import { Tooltip } from './Tooltip';

export function AddArea({
  label,
  onClick,
  className = '',
  disabled = false,
  showLabel = false,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  disabled?: boolean;
  showLabel?: boolean;
}) {
  const button = (
    <button
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
  return showLabel ? button : <Tooltip label={label}>{button}</Tooltip>;
}
