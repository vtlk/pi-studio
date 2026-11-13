import { Trash2 } from 'lucide-react';
import { useConfirm } from '../model/Confirm';
import { Tooltip } from './Tooltip';
export function HoverDeleteButton({
  label,
  description,
  onDelete,
  disabled = false,
}: {
  label: string;
  description?: string;
  onDelete: () => void;
  disabled?: boolean;
}) {
  const { confirm } = useConfirm();
  return (
    <Tooltip label={label}>
      <button
        type="button"
        className="hover-delete"
        aria-label={label}
        disabled={disabled}
        onClick={() => confirm({ title: label, description, onConfirm: onDelete })}
      >
        <Trash2 size={17} strokeWidth={1.8} />
      </button>
    </Tooltip>
  );
}
