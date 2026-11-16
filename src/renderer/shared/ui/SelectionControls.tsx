import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

interface SelectionControlProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

export function Checkbox({ checked, onChange, label, disabled = false }: SelectionControlProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="ui-checkbox"
      onClick={() => onChange(!checked)}
    >
      {checked && <Check size={15} strokeWidth={3} aria-hidden="true" />}
    </button>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  size = 'default',
  trackIcon,
}: SelectionControlProps & { size?: 'default' | 'large'; trackIcon?: ReactNode }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="ui-switch"
      data-size={size}
      onClick={() => onChange(!checked)}
    >
      <span aria-hidden="true" />
      {trackIcon}
    </button>
  );
}
