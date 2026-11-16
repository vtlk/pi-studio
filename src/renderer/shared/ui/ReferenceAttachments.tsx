import { t, i18n } from '../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { File } from 'lucide-react';
import { AddArea } from './AddArea';
import { HoverDeleteButton } from './HoverDeleteButton';
import { Tooltip } from './Tooltip';
import type { ReferenceFile } from '../../../shared/attachments';

export interface ReferenceAttachment extends ReferenceFile {
  file?: globalThis.File;
}

function releaseReferences(attachments: readonly ReferenceAttachment[]) {
  if (!attachments.length || !window.studio) return;
  // The chooser registry is temporary; this never deletes source or copied files.
  void window.studio.releaseReferenceFiles(attachments.map((item) => item.id)).catch(() => {});
}

function AttachmentThumbnail({ attachment }: { attachment: ReferenceAttachment }) {
  useTranslation(undefined, { i18n });
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
  if (size < 1024) return t('ReferenceAttachments.b', { value1: size });
  if (size < 1024 * 1024) return t('ReferenceAttachments.kb', { value1: Math.ceil(size / 1024) });
  return t('ReferenceAttachments.mb', { value1: (size / (1024 * 1024)).toFixed(1) });
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
  useTranslation(undefined, { i18n });
  const input = useRef<HTMLInputElement>(null);
  const current = useRef(value);
  const mounted = useRef(true);
  const [error, setError] = useState('');
  const [choosing, setChoosing] = useState(false);
  useLayoutEffect(() => {
    current.current = value;
  }, [value]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // StrictMode immediately remounts effects; only an actual close releases inputs.
      queueMicrotask(() => {
        if (!mounted.current) releaseReferences(current.current);
      });
    };
  }, []);
  const update = (next: ReferenceAttachment[]) => {
    current.current = next;
    onChange(next);
  };
  const choose = async () => {
    if (!window.studio) {
      input.current?.click();
      return;
    }
    setChoosing(true);
    setError('');
    try {
      const selected = await window.studio.chooseReferenceFiles();
      if (!mounted.current) {
        releaseReferences(selected);
        return;
      }
      if (selected.length + current.current.length > 32) {
        releaseReferences(selected);
        setError(t('ReferenceAttachments.youCanAttachUpToReferencesPer'));
        return;
      }
      update([...selected, ...current.current]);
    } catch (error) {
      if (mounted.current)
        setError(
          error instanceof Error ? error.message : t('ReferenceAttachments.couldNotSelectFiles'),
        );
    } finally {
      if (mounted.current) setChoosing(false);
    }
  };
  return (
    <div
      className="reference-attachments"
      role="group"
      aria-label={t('ReferenceAttachments.references')}
    >
      <span className="reference-attachments-label">{t('ReferenceAttachments.references')}</span>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-label={t('ReferenceAttachments.referenceFiles')}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          update([
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
        label={t('ReferenceAttachments.attachReferenceFiles')}
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
                <Tooltip label={attachment.name} onlyWhenTruncated>
                  <span className="reference-file-name">{attachment.name}</span>
                </Tooltip>
                <small>
                  {fileSize(attachment.size)} · {attachment.type || t('ReferenceAttachments.file')}
                </small>
              </div>
              <HoverDeleteButton
                label={t('ReferenceAttachments.removeReference', { value1: attachment.name })}
                disabled={disabled}
                description={t('ReferenceAttachments.removeThisAttachmentFromTheRequestThe')}
                onDelete={() => {
                  update(current.current.filter((item) => item.id !== attachment.id));
                  releaseReferences([attachment]);
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
