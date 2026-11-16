import { uiText } from '@/shared/model/UiText';
import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { Button } from '@/shared/ui';
import { Modal } from '@/shared/ui/Modal';
import { useConfirm } from '@/shared/model/Confirm';
import { useStorage } from '@/shared/storage/Storage';
import type { Resource } from '../../../../shared/resources';
import type { McpSecretStatus } from '../../../../shared/mcpSecrets';

export function McpSecretsDialog({
  resource,
  onClose,
}: {
  resource: Resource;
  onClose: () => void;
}) {
  useTranslation(undefined, { i18n });
  const { bootstrap, saveNow } = useStorage();
  const { confirm } = useConfirm();
  const [status, setStatus] = useState<McpSecretStatus>();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const folder = bootstrap?.folder;
  useEffect(() => {
    if (!folder || !window.studio) return;
    let current = true;
    void window.studio.readMcpSecretStatus({ folder, resourceId: resource.id }).then(
      (result) => {
        if (current) setStatus(result);
      },
      (error) => {
        if (current)
          setError(
            error instanceof Error
              ? error.message
              : t('McpSecretsDialog.couldNotReadMcpParameters'),
          );
      },
    );
    return () => {
      current = false;
    };
  }, [folder, resource.id]);
  const changed = Object.fromEntries(Object.entries(values).filter(([, value]) => !!value));
  const apply = async (remove = false) => {
    if (!window.studio || !status || !folder || busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (!(await saveNow())) throw new Error(t('TeamTransfers.waitForSettingsToFinishSaving'));
      const request = { folder, resourceId: resource.id, revision: status.revision };
      setStatus(
        remove
          ? await window.studio.removeMcpSecrets(request)
          : await window.studio.saveMcpSecrets({ ...request, values: changed }),
      );
      setValues({});
      setMessage(
        remove
          ? t('McpSecretsDialog.savedValuesDeletedEnterParametersAgainBefore')
          : t('McpSecretsDialog.parametersSavedCheckTheConnectionTheAgent'),
      );
    } catch (error) {
      setError(
        error instanceof Error ? error.message : t('McpSecretsDialog.couldNotSaveMcpParameters'),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t('McpSecretsDialog.protectedParameters', { value1: resource.name })}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            {t('TeamTransfers.close')}
          </Button>
          <Button
            kind="primary"
            disabled={busy || !status?.secureStorageAvailable || !Object.keys(changed).length}
            onClick={() => void apply()}
          >
            {t('McpSecretsDialog.saveParameters')}
          </Button>
        </>
      }
    >
      <p>{t('McpSecretsDialog.keysUseProtectedMacosStorageOutsideStudios')}</p>
      {status && (
        <>
          <p>{status.destination}</p>
          {!status.secureStorageAvailable && (
            <p role="alert">{t('McpSecretsDialog.protectedMacosStorageUnavailableKeySavingIs')}</p>
          )}
          {status.configurationChanged && (
            <p role="alert">
              {t('McpSecretsDialog.serverConfigurationChangedEnterParametersForThe')}
            </p>
          )}
          {status.unreadable && (
            <p role="alert">{t('McpSecretsDialog.couldNotReadSavedParametersEnterThem')}</p>
          )}
          {!status.fields.length && (
            <p>{t('McpSecretsDialog.piSettingsHaveNoVariablesForProtected')}</p>
          )}
          {status.fields.map((field) => (
            <label className="field-label" key={field.name}>
              <span>
                {field.name}
                {field.stored ? t('McpSecretsDialog.saved') : ''}
              </span>
              <input
                type="password"
                aria-label={t('McpSecretsDialog.value', { value1: field.name })}
                autoComplete="new-password"
                spellCheck={false}
                disabled={busy || !status.secureStorageAvailable}
                value={values[field.name] ?? ''}
                placeholder={
                  field.stored
                    ? t('McpSecretsDialog.leaveEmptyToKeepThePreviousValue')
                    : t('McpSecretsDialog.enterAValue')
                }
                onChange={(event) =>
                  setValues((previous) => ({ ...previous, [field.name]: event.target.value }))
                }
              />
            </label>
          ))}
          {status.hasSavedValues && (
            <Button
              disabled={busy}
              onClick={() =>
                confirm({
                  title: uiText('McpSecretsDialog.deleteProtectedParameters'),
                  description: uiText('McpSecretsDialog.deleteAllSavedKeysForMcpFrom', {
                    value1: resource.name,
                  }),
                  confirmLabel: uiText('McpSecretsDialog.delete'),
                  onConfirm: () => apply(true),
                })
              }
            >
              {t('McpSecretsDialog.deleteSavedParameters')}
            </Button>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </Modal>
  );
}
