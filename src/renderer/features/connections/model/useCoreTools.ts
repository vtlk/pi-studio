import { coreTools } from '@/entities/studio/tools';
import { useStorage } from '@/shared/storage/Storage';
import { useConnections } from './Connections';

/** Describe current configuration without a paid API probe or reading a saved secret. */
export function useCoreTools() {
  const { isDesktop } = useStorage();
  const { connections, imageTool, imageStatuses } = useConnections();
  const connection = connections.find(
    (item) => item.id === imageTool.connectionId && item.purpose === 'images',
  );
  const image = imageStatuses[imageTool.connectionId];
  let imageStatus = 'Не настроен';
  if (connection && imageTool.modelId) {
    imageStatus = !image
      ? 'Настроен · состояние не проверено'
      : !image.keyStored
        ? 'Не сохранён API-ключ'
        : image.authentication === 'invalid'
          ? 'Ключ не принят'
          : image.authentication === 'restricted'
            ? 'Доступ ограничен'
            : image.authentication === 'unchecked'
              ? 'Настроен · авторизация не проверена'
              : !image.modelIds.includes(imageTool.modelId)
                ? 'Выбранная модель отсутствует в каталоге'
                : 'Подключение проверено';
  }
  return coreTools.map((tool) => ({
    ...tool,
    status: !isDesktop
      ? 'Не подключён'
      : tool.id === 'web-search'
        ? 'Доступен через MCP'
        : imageStatus,
  }));
}
