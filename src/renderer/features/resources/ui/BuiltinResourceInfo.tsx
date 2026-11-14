import type { Resource } from '../../../../shared/resources';
import { Button } from '@/shared/ui';
import { Modal } from '@/shared/ui/Modal';

export function BuiltinResourceInfo({
  resource,
  onClose,
}: {
  resource: Resource;
  onClose: () => void;
}) {
  return (
    <Modal
      title={resource.name}
      onClose={onClose}
      footer={<Button onClick={onClose}>Закрыть</Button>}
    >
      <p>{resource.description}</p>
      <p>Поставляется с Pi Studio. Встроенный ресурс не удаляется из общего каталога.</p>
      {resource.source === 'builtin:library' && (
        <p>
          Назначается обычному агенту через плюс во вкладке MCP. Связь можно выключить или убрать у
          конкретного агента. Навыки и генераторы выбираются отдельно.
        </p>
      )}
    </Modal>
  );
}
