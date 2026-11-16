import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { getStudioApi } from '@/shared/desktopApi';
import { useState } from 'react';
import type { Resource } from '../../../../shared/resources';
import { useStorage } from '@/shared/storage/Storage';
import { Button } from '@/shared/ui';
import { McpSecretsDialog } from './McpSecretsDialog';
import { ResourceAuthDialog } from './ResourceAuthDialog';

export function ResourceActions({ resource }: { resource: Resource }) {
  useTranslation(undefined, { i18n });
  const { saveNow } = useStorage();
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [secretsOpen, setSecretsOpen] = useState(false);
  const [loginId, setLoginId] = useState<string>();
  if (!window.studio) return null;
  const action = async (kind: 'check' | 'install' | 'login') => {
    if (busy) return;
    setBusy(kind);
    setError('');
    setMessage('');
    try {
      if (!(await saveNow())) throw new Error(t('TeamTransfers.waitForSettingsToFinishSaving'));
      if (kind === 'login') {
        const result = await getStudioApi().openResourceLogin(resource.id);
        setLoginId(result.loginId);
        setMessage(result.loginId ? '' : result.next);
      } else if (kind === 'install') {
        await getStudioApi().installResource(resource.id);
        setMessage(t('ResourceActions.packageAvailableInPiAssignedAgentsLoad'));
      } else {
        const checked = await getStudioApi().checkResource(resource.id);
        setMessage(
          {
            available: t('ResourceActions.resourceAvailableAssignedAgentsLoadItThe'),
            needs_auth: t('ResourceActions.theServerRequiresSignInThroughPi'),
            unavailable: t('ResourceActions.resourceUnavailableCheckSettingsThroughTheAssistant'),
            disabled: t('ResourceActions.serverDisabledInPi'),
          }[checked.status],
        );
      }
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : t('ResourceActions.couldNotPerformTheResourceOperation'),
      );
    } finally {
      setBusy('');
    }
  };
  return (
    <div className="resource-native-actions">
      <div className="action-row">
        <Button
          disabled={!!busy}
          onClick={() => {
            void action('check');
          }}
        >
          {busy === 'check' ? t('ResourceActions.checking') : t('ResourceActions.check')}
        </Button>
        {resource.kind === 'plugins' && (
          <Button
            disabled={!!busy}
            onClick={() => {
              void action('install');
            }}
          >
            {busy === 'install'
              ? t('BrowserResourceStatus.installing')
              : t('ResourceActions.installPackage')}
          </Button>
        )}
        {resource.kind === 'mcps' && resource.source.startsWith('pi:') && (
          <Button
            disabled={!!busy}
            onClick={() => {
              setMessage('');
              setError('');
              setSecretsOpen(true);
            }}
          >
            {t('ResourceActions.protectedParameters')}
          </Button>
        )}
        {resource.kind === 'mcps' && resource.source.startsWith('pi:') && (
          <Button
            disabled={!!busy}
            onClick={() => {
              void action('login');
            }}
          >
            {t('NativeConnectionAuth.signInThroughPi')}
          </Button>
        )}
      </div>
      {message && (
        <p role="status" className="subtle">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {secretsOpen && (
        <McpSecretsDialog resource={resource} onClose={() => setSecretsOpen(false)} />
      )}
      {loginId && (
        <ResourceAuthDialog
          id={loginId}
          name={resource.name}
          onClose={() => setLoginId(undefined)}
        />
      )}
    </div>
  );
}
