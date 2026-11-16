import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { getStudioApi } from '@/shared/desktopApi';
import { useEffect, useState } from 'react';
import { Button } from '@/shared/ui';
import { Modal } from '@/shared/ui/Modal';
import type { AuthLoginState } from '../../../../shared/auth';

export function ResourceAuthDialog({
  id,
  name,
  onClose,
}: {
  id: string;
  name: string;
  onClose: () => void;
}) {
  useTranslation(undefined, { i18n });
  const [state, setState] = useState<AuthLoginState>();
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const read = () =>
      void getStudioApi()
        .readAuthLogin(id)
        .then(
          (value) => {
            if (active) setState(value);
          },
          () => {
            if (active) setError(t('ResourceAuthDialog.couldNotCheckSignInReopenThe'));
          },
        );
    read();
    const timer = setInterval(read, 500);
    return () => {
      active = false;
      clearInterval(timer);
      void window.studio?.cancelAuthLogin(id);
    };
  }, [id]);
  return (
    <Modal
      title={t('ResourceAuthDialog.mcpSignIn', { value1: name })}
      onClose={onClose}
      footer={
        <Button onClick={onClose}>
          {state && ['ready', 'error', 'cancelled'].includes(state.phase)
            ? t('TeamTransfers.close')
            : t('TeamNameDialog.cancel')}
        </Button>
      }
    >
      <p role="status">{state?.message ?? t('ResourceAuthDialog.openingPiSignIn')}</p>
      {state?.prompt && (
        <>
          <p>{t('ResourceAuthDialog.ifTheBrowserDidNotReturnTo')}</p>
          <label className="field-label">
            {t('ResourceAuthDialog.oauthReturnUrl')}
            <input
              type="password"
              aria-label={t('ResourceAuthDialog.oauthReturnUrl')}
              autoComplete="off"
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
            />
          </label>
          <Button
            disabled={!answer.trim()}
            onClick={async () => {
              try {
                await getStudioApi().answerAuthLogin(id, state.prompt!.id, answer);
                setAnswer('');
              } catch {
                setError(t('ResourceAuthDialog.couldNotSubmitTheResponseCheckSign'));
              }
            }}
          >
            {t('NativeConnectionAuth.continueSignIn')}
          </Button>
        </>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </Modal>
  );
}
