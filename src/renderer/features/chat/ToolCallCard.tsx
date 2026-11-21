import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronRight, CircleAlert, CircleDashed, LoaderCircle } from 'lucide-react';
import { t, i18n } from '../../../shared/i18n';
import { Tooltip } from '@/shared/ui/Tooltip';
import {
  prettyToolText,
  toolHeading,
  toolResultPreview,
  toolStatus,
  type ToolCallEntry,
} from './toolCalls';

export interface ToolCardPreference {
  open: boolean;
  errorSeen: boolean;
}
export function ToolCallCard({
  entry,
  working,
  preferences,
  agentNames,
}: {
  entry: ToolCallEntry;
  working: boolean;
  agentNames?: ReadonlyMap<string, string>;
  preferences: Map<string, ToolCardPreference>;
}) {
  useTranslation(undefined, { i18n });
  const status = toolStatus(entry, working),
    error = status === 'error';
  const [open, setOpen] = useState(() => preferences.get(entry.key)?.open ?? error);
  useEffect(() => {
    const saved = preferences.get(entry.key);
    if (error && !saved?.errorSeen) {
      preferences.set(entry.key, { open: true, errorSeen: true });
      setOpen(true);
    } else if (!saved) preferences.set(entry.key, { open, errorSeen: false });
  }, [entry.key, error, preferences, open]);
  const heading = toolHeading(entry, status, agentNames),
    preview = toolResultPreview(entry.result);
  const Icon =
    status === 'running'
      ? LoaderCircle
      : status === 'success'
        ? Check
        : status === 'error'
          ? CircleAlert
          : CircleDashed;
  return (
    <details
      className="pi-tool-card"
      data-status={status}
      data-call-id={entry.call.id}
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        preferences.set(entry.key, {
          open: next,
          errorSeen: error || preferences.get(entry.key)?.errorSeen === true,
        });
        setOpen(next);
      }}
    >
      <summary>
        <Icon
          size={16}
          className={
            status === 'running' ? 'project-launch-spinner pi-tool-status' : 'pi-tool-status'
          }
          aria-hidden="true"
        />
        <span className="pi-tool-summary">
          <span className="pi-tool-heading">
            {heading.label}
            {heading.target && (
              <>
                {' '}
                <code>{heading.target}</code>
              </>
            )}
          </span>
          <span className="pi-tool-preview">
            {preview ||
              t(
                status === 'running'
                  ? 'ToolCard.awaitingResult'
                  : status === 'missing'
                    ? 'ToolCard.missingResult'
                    : 'ToolCard.emptyResult',
              )}
          </span>
        </span>
        {heading.friendly && !heading.builtin && (
          <Tooltip label={heading.name}>
            <code className="pi-tool-identifier">{heading.name}</code>
          </Tooltip>
        )}
        <ChevronRight size={15} className="pi-tool-chevron" aria-hidden="true" />
      </summary>
      <div className="pi-tool-details">
        <div className="pi-tool-detail-heading">
          {t('ToolCard.toolName')}: <code>{heading.name}</code>
        </div>
        <h4>{t('ToolCard.arguments')}</h4>
        <pre>
          {entry.call.arguments
            ? prettyToolText(entry.call.arguments)
            : t('ToolCard.argumentsUnavailable')}
        </pre>
        <h4>{t('ToolCard.result')}</h4>
        {entry.result ? (
          <>
            {entry.result.parts.map((part, index) =>
              part.type === 'image' ? (
                part.src ? (
                  <img key={index} src={part.src} alt={t('Chat.image')} />
                ) : (
                  <p key={index}>{t('Chat.image')}</p>
                )
              ) : (
                part.text && <pre key={index}>{prettyToolText(part.text)}</pre>
              ),
            )}
            {entry.result.error && <pre className="error-message">{entry.result.error}</pre>}
            {!entry.result.parts.length && !entry.result.error && (
              <p>{t('ToolCard.emptyResult')}</p>
            )}
          </>
        ) : (
          <p>{t(status === 'running' ? 'ToolCard.awaitingResult' : 'ToolCard.missingResult')}</p>
        )}
      </div>
    </details>
  );
}
