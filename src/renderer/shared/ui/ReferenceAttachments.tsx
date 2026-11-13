import { useEffect, useRef, useState } from 'react';
import { File } from 'lucide-react';
import { AddArea } from './AddArea';
import { HoverDeleteButton } from './HoverDeleteButton';
import { Tooltip } from './Tooltip';
import type { ReferenceFile } from '../../../shared/attachments';

export interface ReferenceAttachment extends ReferenceFile {
  file?: globalThis.File;
}

function AttachmentThumbnail({ attachment }: { attachment: ReferenceAttachment }) {
  const { file } = attachment;
  const [source, setSource] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!file?.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    setSource(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (attachment.preview || source) && !failed ? (
    <img src={attachment.preview || source} alt="" onError={() => setFailed(true)} />
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
  disabled = false,
}: {
  value: ReferenceAttachment[];
  onChange: (attachments: ReferenceAttachment[]) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [choosing, setChoosing] = useState(false);
  const choose = async () => {
    if (!window.studio) {
      input.current?.click();
      return;
    }
    setChoosing(true);
    setError('');
    try {
      onChange([...(await window.studio.chooseReferenceFiles()), ...value]);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось выбрать файлы.');
    } finally {
      setChoosing(false);
    }
  };
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
          onChange([
            ...files.map((file) => ({
              id: crypto.randomUUID(),
              file,
              name: file.name,
              size: file.size,
              type: file.type,
            })),
            ...value,
          ]);
          event.target.value = '';
        }}
      />
      <AddArea
        label="Прикрепить файлы референса"
        disabled={disabled || choosing}
        onClick={() => void choose()}
      />
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {value.length > 0 && (
        <ul className="reference-attachment-list">
          {value.map((attachment) => (
            <li key={attachment.id} className="reference-attachment" data-removable>
              <div className="reference-thumbnail">
                <AttachmentThumbnail attachment={attachment} />
              </div>
              <div className="reference-file-info">
                <Tooltip label={attachment.name}>
                  <span className="reference-file-name">{attachment.name}</span>
                </Tooltip>
                <small>
                  {fileSize(attachment.size)} · {attachment.type || 'файл'}
                </small>
              </div>
              <HoverDeleteButton
                label={`Убрать референс «${attachment.name}»`}
                disabled={disabled}
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
