import type { OutputFile } from '../model/workspace.types';
import { getPreviewKind } from '../model/previewCapabilities';
import { MarkdownPreview } from './MarkdownPreview';
import { useState } from 'react';
import type { MarkdownFiles } from '../model/markdownFiles';

export function OutputPreview({
  file,
  markdownFiles,
}: {
  file: OutputFile;
  markdownFiles?: MarkdownFiles;
}) {
  const [mediaError, setMediaError] = useState('');
  const error = mediaError && (
    <p className="error-message" role="alert">
      {mediaError}
    </p>
  );
  switch (getPreviewKind(file)) {
    case 'markdown':
      return <MarkdownPreview content={file.content ?? ''} files={markdownFiles} />;
    case 'image':
      return (
        <div className="output-image">
          <img
            src={file.src}
            alt={file.name}
            onError={() =>
              setMediaError(
                'Не удалось открыть изображение. Файл повреждён, недоступен или имеет неподдерживаемый формат.',
              )
            }
          />
          {error}
        </div>
      );
    case 'audio':
      return (
        <div className="media-example">
          <audio
            controls
            src={file.src}
            aria-label={file.name}
            onError={() =>
              setMediaError(
                'Не удалось воспроизвести аудио. Проверьте доступность файла и поддержку кодека в macOS.',
              )
            }
          />
          {error}
          {!file.src && <p>Пример аудиофайла · звук не сгенерирован.</p>}
        </div>
      );
    case 'unsupported':
      return (
        <div className="media-example">
          <p>Для этого типа файла нет встроенного предпросмотра.</p>
        </div>
      );
    case 'video':
      return (
        <div className="media-example">
          <video
            controls
            src={file.src}
            aria-label={file.name}
            onError={() =>
              setMediaError(
                'Не удалось воспроизвести видео. Проверьте доступность файла и поддержку кодека в macOS.',
              )
            }
          />
          {error}
          {!file.src && <p>Пример видеофайла · видео не сгенерировано.</p>}
        </div>
      );
    default:
      return (
        <>
          <pre className={`output-text${file.format === 'json' ? ' output-code' : ''}`}>
            {file.content || 'Файл пуст.'}
          </pre>
        </>
      );
  }
}
