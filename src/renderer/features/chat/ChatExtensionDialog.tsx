import { useState } from 'react';
import type { ChatDialog, ChatTarget } from '../../../shared/chat';
import { t, i18n } from '../../../shared/i18n';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui';
import { Textarea } from '@/shared/ui/Textarea';
import { Select } from '@/shared/ui/Select';

export function ChatExtensionDialog({
  target,
  dialog,
}: {
  target: ChatTarget;
  dialog: ChatDialog;
}) {
  useTranslation(undefined, { i18n });
  const [value, setValue] = useState(dialog.prefill ?? dialog.options?.[0] ?? '');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const respond = async (cancelled: boolean) => {
    if (!window.studio || busy) return;
    setBusy(true);
    try {
      await window.studio.answerChat({
        ...target,
        id: dialog.id,
        cancelled,
        value,
        confirmed: !cancelled,
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : t('Chat.commandFailed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="chat-extension-dialog" aria-label={dialog.title}>
      <h3>{dialog.title}</h3>
      {dialog.message && <p>{dialog.message}</p>}
      {dialog.method === 'select' ? (
        <Select
          label={dialog.title}
          options={dialog.options ?? []}
          value={value}
          onValueChange={setValue}
          disabled={busy}
        />
      ) : (
        dialog.method !== 'confirm' && (
          <Textarea
            label={dialog.title}
            placeholder={dialog.placeholder}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={busy}
          />
        )
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <div className="chat-dialog-actions">
        <Button onClick={() => void respond(true)} disabled={busy}>
          {t('TeamNameDialog.cancel')}
        </Button>
        <Button kind="primary" onClick={() => void respond(false)} disabled={busy}>
          {t('Chat.confirm')}
        </Button>
      </div>
    </section>
  );
}
