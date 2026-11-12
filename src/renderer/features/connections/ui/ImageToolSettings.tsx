import { EmptyIntegration } from '@/shared/ui';
import { Disclosure } from '@/shared/ui/Disclosure';
import { Select } from '@/shared/ui/Select';
import { useConnections } from '../model/Connections';

export function ImageToolSettings() {
  const { connections, imageTool, setImageTool } = useConnections();
  const connection = connections.find((item) => item.id === imageTool.connectionId);
  const available = connection?.purpose === 'images';
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
        <input
          placeholder="ID модели Images API"
          value={imageTool.modelId}
          onChange={(event) => setImageTool({ ...imageTool, modelId: event.target.value })}
        />
      </label>
      <EmptyIntegration>
        Не подключён. Настройки сохраняются в памяти прототипа; MCP-сервер и API-запросы пока не
        реализованы. При неизвестных возможностях модели автоматического запроса нет.
      </EmptyIntegration>
    </Disclosure>
  );
}
