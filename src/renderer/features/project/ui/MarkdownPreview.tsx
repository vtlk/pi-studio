import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Square, SquareCheck } from 'lucide-react';

export function MarkdownPreview({ content }: { content: string }) {
  return (
    <article className="output-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
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
