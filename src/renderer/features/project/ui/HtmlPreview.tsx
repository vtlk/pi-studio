import { useEffect, useEffectEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { t, i18n } from '../../../../shared/i18n/index.ts';
import type { OutputFile } from '../model/workspace.types';
import type { MarkdownFiles } from '../model/markdownFiles';
import { htmlDocument, htmlPreviewPolicy, htmlScriptNonce } from '../model/htmlDocument';
import { CodePreview } from './CodePreview';

export function HtmlPreview({ file, files }: { file: OutputFile; files?: MarkdownFiles }) {
  useTranslation(undefined, { i18n });
  const [source, setSource] = useState(false);
  const [scripts, setScripts] = useState(false);
  const [result, setResult] = useState<{ srcDoc: string; missing: boolean }>();
  const [failed, setFailed] = useState(false);
  const prepare = useEffectEvent((signal: AbortSignal) =>
    htmlDocument(file.content ?? '', files, signal, scripts),
  );
  const assetVersion = JSON.stringify(
    files?.files.map((entry) => [entry.diskPath, entry.fingerprint]),
  );
  useEffect(() => {
    const controller = new AbortController();
    const limit = setTimeout(() => controller.abort(), 15_000);
    void prepare(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setResult(value);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      })
      .finally(() => clearTimeout(limit));
    let disposed = false;
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(limit);
    };
  }, [
    file.id,
    file.fingerprint,
    file.content,
    files?.projectId,
    files?.path,
    assetVersion,
    scripts,
  ]);
  return (
    <section className="html-preview">
      <div className="html-preview-toolbar" role="group" aria-label={t('HtmlPreview.view')}>
        <button type="button" aria-pressed={!source} onClick={() => setSource(false)}>
          {t('HtmlPreview.preview')}
        </button>
        <button type="button" aria-pressed={source} onClick={() => setSource(true)}>
          {t('HtmlPreview.source')}
        </button>
        {!source && (
          <button
            type="button"
            aria-pressed={scripts}
            onClick={() => {
              setResult(undefined);
              setScripts((value) => !value);
            }}
          >
            {t(scripts ? 'HtmlPreview.disableScripts' : 'HtmlPreview.enableScripts')}
          </button>
        )}
        <small>{t(scripts ? 'HtmlPreview.scriptRestrictions' : 'HtmlPreview.restrictions')}</small>
      </div>
      {source ? (
        <CodePreview file={file} />
      ) : failed ? (
        <p className="error-message" role="alert">
          {t('HtmlPreview.failed')}
        </p>
      ) : result ? (
        <>
          {result.missing && (
            <p className="html-preview-note" role="status">
              {t('HtmlPreview.missing')}
            </p>
          )}
          <iframe
            key={String(scripts)}
            className="html-preview-frame"
            title={t('HtmlPreview.title', { name: file.name })}
            sandbox={scripts ? 'allow-scripts' : ''}
            {...{
              csp: scripts
                ? htmlPreviewPolicy.replace(
                    "script-src 'none'",
                    `script-src 'nonce-${htmlScriptNonce}'`,
                  )
                : htmlPreviewPolicy,
            }}
            allow="camera 'none'; microphone 'none'; geolocation 'none'; display-capture 'none'; clipboard-read 'none'; clipboard-write 'none'"
            referrerPolicy="no-referrer"
            srcDoc={result.srcDoc}
          />
        </>
      ) : (
        <p className="output-empty" role="status">
          {t('HtmlPreview.loading')}
        </p>
      )}
    </section>
  );
}
