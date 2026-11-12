import type { OutputFile } from '../model/workspace.types';
import { getPreviewKind } from '../model/previewCapabilities';
import { MarkdownPreview } from './MarkdownPreview';

export function OutputPreview({ file }: { file: OutputFile }) {
  switch (getPreviewKind(file)) {
    case 'markdown':
      return <MarkdownPreview content={file.content ?? ''} />;
    case 'image':
      return (
        <div className="output-image">
          <img src={file.src} alt={file.name} />
        </div>
      );
    case 'audio':
      return (
        <div className="media-example">
          <audio controls src={file.src} aria-label={file.name} />
          {!file.src && <p>Пример аудиофайла · звук не сгенерирован.</p>}
        </div>
      );
    case 'unsupported':
      return (
        <div className="media-example">
          <h3>{file.name}</h3>
          <p>Для этого типа файла нет встроенного предпросмотра.</p>
        </div>
      );
    case 'video':
      return (
        <div className="media-example">
          <video controls src={file.src} aria-label={file.name} />
          {!file.src && <p>Пример видеофайла · видео не сгенерировано.</p>}
        </div>
      );
    default:
      return (
        <pre className={`output-text${file.format === 'json' ? ' output-code' : ''}`}>
          {file.content || 'Файл пуст.'}
        </pre>
      );
  }
}
