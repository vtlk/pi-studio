import { uiText } from '@/shared/model/UiText';
import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { Disclosure, DisclosureList } from '@/shared/ui/Disclosure';
import { Select } from '@/shared/ui/Select';
import { Button } from '@/shared/ui';
import { useState } from 'react';
import { useStorage } from '@/shared/storage/Storage';
import { useNotice } from '@/shared/model/Notice';
import { useConnections } from '../model/Connections';

export function ImageToolSettings() {
  useTranslation(undefined, { i18n });
  const { connections, imageTool, setImageTool, imageStatuses, refreshImageConnection } =
    useConnections();
  const { bootstrap } = useStorage();
  const { demo } = useNotice();
  const [busy, setBusy] = useState(false);
  const connection = connections.find((item) => item.id === imageTool.connectionId);
  const available = connection?.purpose === 'images';
  const status = imageStatuses[imageTool.connectionId],
    models = status?.modelIds ?? [];
  const options = [
    { value: 'none', label: t('ModelPanel.notSelected') },
    ...connections
      .filter((item) => item.purpose === 'images')
      .map((item) => ({
        value: item.id,
        label: item.name,
      })),
    ...(imageTool.connectionId && !available
      ? [{ value: imageTool.connectionId, label: t('ModelPanel.connectionUnavailable') }]
      : []),
  ];
  return (
    <DisclosureList>
      <Disclosure label={t('ImageToolSettings.imageGenerationInternalMcp')}>
        <p>{t('ImageToolSettings.sharedToolForAgentsWhoseModelDoes')}</p>
        <label className="field-label">
          {t('ImageToolSettings.toolApiConnection')}
          <Select
            label={t('ImageToolSettings.imageGenerationApiConnection')}
            options={options}
            value={imageTool.connectionId || 'none'}
            onValueChange={(id) =>
              setImageTool({ connectionId: id === 'none' ? '' : id, modelId: '' })
            }
          />
        </label>
        <label className="field-label">
          {t('ImageToolSettings.imagegenModel')}
          <Select
            label={t('ImageToolSettings.imagegenModel')}
            value={imageTool.modelId || 'none'}
            disabled={!available || busy}
            options={[
              { value: 'none', label: t('ModelPanel.selectAModel') },
              ...models.map((id) => ({ value: id, label: id })),
              ...(imageTool.modelId && !models.includes(imageTool.modelId)
                ? [
                    {
                      value: imageTool.modelId,
                      label: t('ImageToolSettings.unchecked', { value1: imageTool.modelId }),
                    },
                  ]
                : []),
            ]}
            onValueChange={(id) => setImageTool({ ...imageTool, modelId: id === 'none' ? '' : id })}
          />
        </label>
        <Button
          disabled={!window.studio || !bootstrap || !available || busy || !status?.keyStored}
          onClick={async () => {
            if (!window.studio || !bootstrap) return;
            setBusy(true);
            try {
              await window.studio.checkImageConnection({
                folder: bootstrap.folder,
                connectionId: imageTool.connectionId,
              });
              await refreshImageConnection(imageTool.connectionId);
            } catch (error) {
              await refreshImageConnection(imageTool.connectionId).catch(() => {});
              demo(
                error instanceof Error
                  ? error.message
                  : uiText('ImageToolSettings.couldNotReadImagesApiModels'),
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('ImageToolSettings.refreshImagesApiModels')}
        </Button>
        <p className="subtle">{t('ImageToolSettings.theCheckReadsTheApiCatalogWithout')}</p>
        <p className="subtle">
          {t('ImageToolSettings.codexConnectionsAreCurrentlySupportedIfPlugins')}
        </p>
      </Disclosure>
    </DisclosureList>
  );
}
