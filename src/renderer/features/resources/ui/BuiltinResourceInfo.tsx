import type { Resource } from '../../../../shared/resources';
import { Button } from '@/shared/ui';
import { Modal } from '@/shared/ui/Modal';
import { BrowserResourceStatus } from './BrowserResourceStatus';
import { ComputerResourceStatus } from './ComputerResourceStatus';

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
      {resource.source === 'builtin:browser' && <BrowserResourceStatus />}
      {resource.source === 'builtin:computer' && <ComputerResourceStatus />}
    </Modal>
  );
}
