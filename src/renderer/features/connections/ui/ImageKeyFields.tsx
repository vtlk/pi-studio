import { uiText } from '@/shared/model/UiText';
import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui';
import { useConfirm } from '@/shared/model/Confirm';
import { useNotice } from '@/shared/model/Notice';
import { useStorage } from '@/shared/storage/Storage';
import { useConnections } from '../model/Connections';

export function ImageKeyFields({
  id,
  name,
  value,
  setValue,
  busy,
  setBusy,
}: {
  id: string;
  name: string;
  value: string;
  setValue: (value: string) => void;
  busy: boolean;
  setBusy: (value: boolean) => void;
}) {
  useTranslation(undefined, { i18n });
  const { bootstrap } = useStorage();
  const { imageStatuses, refreshImageConnection } = useConnections();
  const status = imageStatuses[id];
  const { confirm } = useConfirm(),
    { demo } = useNotice();
  return (
    <>
      <p>{t('ImageKeyFields.theImagesApiIsBilledSeparatelyFrom')}</p>
      <label className="field-label">
        {t('ConnectionEditor.apiKey')}
        <input
          type="password"
          aria-label={t('ImageKeyFields.imagesApiKey')}
          autoComplete="off"
          spellCheck={false}
          value={value}
          disabled={!window.studio || busy}
          placeholder={
            status?.keyStored
              ? t('ImageKeyFields.keySavedEnterANewKeyTo')
              : t('ImageKeyFields.enterAnApiKey')
          }
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <p className="subtle">{t('ImageKeyFields.theKeyIsProtectedByMacosStorage')}</p>
      {status?.keyStored && (
        <Button
          disabled={busy}
          onClick={() =>
            confirm({
              title: uiText('ImageKeyFields.deleteTheApiKeyForConnection', {
                value1: name.trim() || id,
              }),
              description: uiText('ImageKeyFields.theKeyWillBeRemovedFromThis'),
              confirmLabel: uiText('ImageKeyFields.deleteKey'),
              onConfirm: () => {
                if (!window.studio || !bootstrap) return;
                setBusy(true);
                void window.studio
                  .removeImageKey({ folder: bootstrap.folder, connectionId: id })
                  .then(async () => {
                    setValue('');
                    await refreshImageConnection(id);
                  })
                  .catch((error) =>
                    demo(
                      error instanceof Error
                        ? error.message
                        : uiText('ImageKeyFields.couldNotDeleteTheKey'),
                    ),
                  )
                  .finally(() => setBusy(false));
              },
            })
          }
        >
          {t('ImageKeyFields.deleteSavedKey')}
        </Button>
      )}
      {status && (
        <p role="status">
          {!status.keyStored
            ? t('ImageKeyFields.keyNotSaved')
            : status.authentication === 'ready'
              ? t('ImageKeyFields.keyAcceptedByTheApiGenerationAccess')
              : status.authentication === 'invalid'
                ? t('ImageKeyFields.theApiRejectedTheKey')
                : status.authentication === 'restricted'
                  ? t('ImageKeyFields.theApiRestrictedAccessCheckTheKey')
                  : t('ImageKeyFields.keySavedAuthenticationHasNotBeenChecked')}
        </p>
      )}
    </>
  );
}
