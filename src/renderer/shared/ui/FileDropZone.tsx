import { useRef, useState, type ReactNode } from 'react';
import { Upload } from 'lucide-react';
/** Native files only; text selection/drag and ordinary paste keep their normal behavior. */
export function FileDropZone({
  children,
  label,
  className = '',
  disabled = false,
  onFiles,
  onImages,
  as: Tag = 'div',
  ariaLabel,
}: {
  as?: 'div' | 'section';
  ariaLabel?: string;
  children: ReactNode;
  label: string;
  className?: string;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  onImages?: (files: File[]) => void;
}) {
  const entered = useRef(0);
  const [active, setActive] = useState(false);
  return (
    <Tag
      aria-label={ariaLabel}
      className={`file-drop-zone ${className}${active && !disabled ? ' file-drop-active' : ''}`}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        entered.current++;
        if (!disabled) setActive(true);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
      }}
      onDragLeave={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        if (--entered.current <= 0) {
          entered.current = 0;
          setActive(false);
        }
      }}
      onDragEnd={() => {
        entered.current = 0;
        setActive(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.stopPropagation();
        entered.current = 0;
        setActive(false);
        if (!disabled) {
          const files = Array.from(event.dataTransfer.files);
          if (files.length) onFiles(files);
        }
      }}
      onPaste={(event) => {
        if (!onImages || disabled) return;
        const images = Array.from(event.clipboardData.files).filter((file) =>
          file.type.startsWith('image/'),
        );
        if (!images.length) return;
        event.preventDefault();
        event.stopPropagation();
        onImages(images);
      }}
    >
      {children}
      {active && !disabled && (
        <div className="file-drop-overlay" aria-hidden="true">
          <Upload size={24} />
          <span>{label}</span>
        </div>
      )}
    </Tag>
  );
}
