import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { coreTools } from '@/entities/studio/tools';
import { useStorage } from '@/shared/storage/Storage';
import { useConnections } from './Connections';

/** Describe current configuration without a paid API probe or reading a saved secret. */
export function useCoreTools() {
  useTranslation(undefined, { i18n });
  const { isDesktop } = useStorage();
  const { connections, imageTool, imageStatuses } = useConnections();
  const connection = connections.find(
    (item) => item.id === imageTool.connectionId && item.purpose === 'images',
  );
  const image = imageStatuses[imageTool.connectionId];
  let imageStatus = t('useCoreTools.notConfigured');
  if (connection && imageTool.modelId) {
    imageStatus = !image
      ? t('useCoreTools.configuredStatusUnchecked')
      : !image.keyStored
        ? t('useCoreTools.noSavedApiKey')
        : image.authentication === 'invalid'
          ? t('useCoreTools.keyRejected')
          : image.authentication === 'restricted'
            ? t('useCoreTools.accessRestricted')
            : image.authentication === 'unchecked'
              ? t('useCoreTools.configuredAuthenticationUnchecked')
              : !image.modelIds.includes(imageTool.modelId)
                ? t('useCoreTools.theSelectedModelIsMissingFromThe')
                : t('useCoreTools.connectionVerified');
  }
  return coreTools().map((tool) => ({
    ...tool,
    status: !isDesktop
      ? t('useCoreTools.notConnected')
      : tool.id === 'web-search'
        ? t('useCoreTools.availableThroughMcp')
        : imageStatus,
  }));
}
