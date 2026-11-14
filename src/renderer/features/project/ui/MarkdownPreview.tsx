import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Square, SquareCheck } from 'lucide-react';
import { useState } from 'react';
import { markdownFile, type MarkdownFiles } from '../model/markdownFiles';
import { outputMediaUrl } from '../../../../shared/outputPaths';

function MarkdownImage({ src, alt, title }: { src?: string; alt?: string; title?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed)
    return (
      <span className="error-message" role="img" aria-label={alt || 'Изображение'}>
        Изображение недоступно{alt ? `: ${alt}` : '.'}
      </span>
    );
  return <img src={src} alt={alt ?? ''} title={title} onError={() => setFailed(true)} />;
}

export function MarkdownPreview({ content, files }: { content: string; files?: MarkdownFiles }) {
  return (
    <article className="output-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) => {
            const local = files && href ? markdownFile(files, href) : undefined;
            if (local && files)
              return (
                <a
                  href={href}
                  onClick={(event) => {
                    event.preventDefault();
                    files.onSelect(local.id);
                  }}
                >
                  {children}
                </a>
              );
            if (files && !/^https?:\/\//i.test(href ?? '') && !href?.startsWith('#'))
              return <span className="error-message">Ссылка недоступна: {children}</span>;
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
          img: ({ src, alt, title }) => {
            const local = files && src ? markdownFile(files, src) : undefined;
            const resolved = files
              ? local?.format === 'image' && local.diskPath
                ? outputMediaUrl(files.projectId, local.diskPath, local.fingerprint)
                : undefined
              : src;
            return <MarkdownImage key={resolved || src} src={resolved} alt={alt} title={title} />;
          },
          input: ({ checked }) => (
            <span
              className="markdown-task-marker"
              role="img"
              aria-label={checked ? 'Выполнено' : 'Не выполнено'}
            >
              {checked ? (
                <SquareCheck size={17} aria-hidden="true" />
              ) : (
                <Square size={17} aria-hidden="true" />
              )}
            </span>
          ),
        }}
      >
        {content || 'Файл пуст.'}
      </Markdown>
    </article>
  );
}
