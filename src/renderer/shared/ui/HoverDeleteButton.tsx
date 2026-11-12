import { Trash2 } from 'lucide-react';
import { useConfirm } from '../model/Confirm';
import { Tooltip } from './Tooltip';
export function HoverDeleteButton({
  label,
  description,
  onDelete,
}: {
  label: string;
  description?: string;
  onDelete: () => void;
}) {
  const { confirm } = useConfirm();
  return (
    <Tooltip label={label}>
      <button
        type="button"
        className="hover-delete"
        aria-label={label}
        onClick={() => confirm({ title: label, description, onConfirm: onDelete })}
      >
        <Trash2 size={17} strokeWidth={1.8} />
      </button>
    </Tooltip>
  );
}
