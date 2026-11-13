import { Disclosure } from '@/shared/ui/Disclosure';
import { Select } from '@/shared/ui/Select';
import { Button } from '@/shared/ui';
import { useState } from 'react';
import { useStorage } from '@/shared/storage/Storage';
import { useNotice } from '@/shared/model/Notice';
import { useConnections } from '../model/Connections';

export function ImageToolSettings() {
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
    { value: 'none', label: 'Не выбрано' },
    ...connections
      .filter((item) => item.purpose === 'images')
      .map((item) => ({
        value: item.id,
        label: item.name,
      })),
    ...(imageTool.connectionId && !available
      ? [{ value: imageTool.connectionId, label: 'Подключение недоступно' }]
      : []),
  ];
  return (
    <Disclosure label="Генерация изображений · внутренний MCP">
      <p>
        Общий инструмент для агентов, чья модель не поддерживает генерацию изображений. Модель и
        effort агента сохраняются. Использование Images API оплачивается отдельно.
      </p>
      <label className="field-label">
        API-подключение инструмента
        <Select
          label="API-подключение генерации изображений"
          options={options}
          value={imageTool.connectionId || 'none'}
          onValueChange={(id) =>
            setImageTool({ connectionId: id === 'none' ? '' : id, modelId: '' })
          }
        />
      </label>
      <label className="field-label">
        Модель ImageGen
        <Select
          label="Модель ImageGen"
          value={imageTool.modelId || 'none'}
          disabled={!available || busy}
          options={[
            { value: 'none', label: 'Выберите модель' },
            ...models.map((id) => ({ value: id, label: id })),
            ...(imageTool.modelId && !models.includes(imageTool.modelId)
              ? [{ value: imageTool.modelId, label: `${imageTool.modelId} · не проверена` }]
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
              error instanceof Error ? error.message : 'Не удалось прочитать модели Images API.',
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        Обновить модели Images API
      </Button>
      <p className="subtle">
        Проверка читает каталог API и не создаёт изображение. Модель выбирается явно; модель агента
        не меняется.
      </p>
      <p className="subtle">
        Сейчас поддержано подключение Codex. Если плагины меняют возможности модели или поддержка
        генерации ещё не определена, платный резерв не подключается. Внешние генераторы можно
        назначить агенту отдельно.
      </p>
    </Disclosure>
  );
}
