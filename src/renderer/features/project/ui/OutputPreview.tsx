import { CodePreview } from './CodePreview';
import { Mp4Preview } from './Mp4Preview';
import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import type { OutputFile } from '../model/workspace.types';
import { getPreviewKind } from '../model/previewCapabilities';
import { HtmlPreview } from './HtmlPreview';
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
  useTranslation(undefined, { i18n });
  const [mediaError, setMediaError] = useState('');
  const error = mediaError && (
    <p className="error-message" role="alert">
      {mediaError}
    </p>
  );
  switch (getPreviewKind(file)) {
    case 'code':
      return <CodePreview file={file} />;
    case 'html':
      return <HtmlPreview file={file} files={markdownFiles} />;
    case 'markdown':
      return <MarkdownPreview content={file.content ?? ''} files={markdownFiles} />;
    case 'image':
      return (
        <div className="output-image">
          <img
            src={file.src}
            alt={file.name}
            onError={() => setMediaError(t('OutputPreview.couldNotOpenTheImageTheFile'))}
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
            onError={() => setMediaError(t('OutputPreview.couldNotPlayTheAudioCheckFile'))}
          />
          {error}
          {!file.src && <p>{t('OutputPreview.exampleAudioFileNoAudioGenerated')}</p>}
        </div>
      );
    case 'unsupported':
      return (
        <div className="media-example">
          <p>{t('OutputPreview.noBuiltInPreviewForThisFile')}</p>
        </div>
      );
    case 'video':
      if (/\.mp4$/i.test(file.name)) return <Mp4Preview file={file} />;
      return (
        <div className="media-example">
          <video
            controls
            src={file.src}
            aria-label={file.name}
            onError={() => setMediaError(t('OutputPreview.couldNotPlayTheVideoCheckFile'))}
          />
          {error}
          {!file.src && <p>{t('OutputPreview.exampleVideoFileNoVideoGenerated')}</p>}
        </div>
      );
    default:
      return (
        <>
          <pre className={`output-text${file.format === 'json' ? ' output-code' : ''}`}>
            {file.content || t('MarkdownPreview.theFileIsEmpty')}
          </pre>
        </>
      );
  }
}
