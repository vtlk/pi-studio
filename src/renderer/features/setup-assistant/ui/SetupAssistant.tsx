import { Button, EmptyIntegration } from '@/shared/ui';
import { useNotice } from '@/shared/model/Notice';

export function SetupAssistant() {
  const { demo } = useNotice();
  return (
    <>
      <h2>Помощник подключения</h2>
      <p>
        Подключение skills, MCP и пакетов Pi, а также выдача доступа агентам — в диалоге с
        помощником в Pi.
      </p>
      <Button
        kind="primary"
        onClick={() =>
          demo(
            'Диалог помощника будет открыт в Pi через macOS Terminal. Запуск Pi пока не подключён.',
          )
        }
      >
        Открыть помощника в Pi
      </Button>
      <EmptyIntegration>
        Веб-поиск — общий инструмент всех агентов, включая помощника. Пока не подключён.
      </EmptyIntegration>
    </>
  );
}
