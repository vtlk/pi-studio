import { useEffect, useRef, useState } from 'react';
import { File } from 'lucide-react';
import { AddArea } from './AddArea';
import { HoverDeleteButton } from './HoverDeleteButton';
import { Tooltip } from './Tooltip';

export interface ReferenceAttachment {
  id: string;
  file: globalThis.File;
}

function AttachmentThumbnail({ file }: { file: globalThis.File }) {
  const [source, setSource] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    setSource(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return source && !failed ? (
    <img src={source} alt="" onError={() => setFailed(true)} />
  ) : (
    <File size={22} aria-hidden="true" />
  );
}

function fileSize(size: number) {
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} КБ`;
  return `${(size / (1024 * 1024)).toFixed(1)} МБ`;
}

export function ReferenceAttachments({
  value,
  onChange,
}: {
  value: ReferenceAttachment[];
  onChange: (attachments: ReferenceAttachment[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="reference-attachments" role="group" aria-label="Референсы">
      <span className="reference-attachments-label">Референсы</span>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-label="Файлы референса"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          onChange([...files.map((file) => ({ id: crypto.randomUUID(), file })), ...value]);
          event.target.value = '';
        }}
      />
      <AddArea label="Прикрепить файлы референса" onClick={() => input.current?.click()} />
      {value.length > 0 && (
        <ul className="reference-attachment-list">
          {value.map((attachment) => (
            <li key={attachment.id} className="reference-attachment" data-removable>
              <div className="reference-thumbnail">
                <AttachmentThumbnail file={attachment.file} />
              </div>
              <div className="reference-file-info">
                <Tooltip label={attachment.file.name}>
                  <span className="reference-file-name">{attachment.file.name}</span>
                </Tooltip>
                <small>{fileSize(attachment.file.size)}</small>
              </div>
              <HoverDeleteButton
                label={`Убрать референс «${attachment.file.name}»`}
                description="Убрать вложение из запроса? Исходный файл останется на месте."
                onDelete={() => onChange(value.filter((item) => item.id !== attachment.id))}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
