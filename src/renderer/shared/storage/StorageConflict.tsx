import type { StorageSection } from '../../../shared/storage';
import { Button } from '../ui';
import { Modal } from '../ui/Modal';

const sectionNames: Record<StorageSection, string> = {
  agents: 'Агенты',
  agentTeams: 'Команды агентов',
  agentCatalog: 'Команды и агенты',
  systemAgents: 'Системные агенты',
  libraryAgents: 'Агенты библиотеки',
  resources: 'Ресурсы',
  connections: 'Подключения',
  imageTool: 'Генерация изображений',
  hiddenLibraryIds: 'Библиотека',
  baseInstruction: 'Общие инструкции',
  piPath: 'Путь к Pi',
};

export function StorageConflict({
  section,
  reloading,
  onClose,
  onReload,
}: {
  section: StorageSection;
  reloading: boolean;
  onClose: () => void;
  onReload: () => void;
}) {
  return (
    <Modal
      title="Настройки изменились"
      onClose={onClose}
      alert
      footer={
        <>
          <Button onClick={onClose}>Вернуться к моим правкам</Button>
          <Button disabled={reloading} onClick={onReload}>
            {reloading ? 'Перечитываем…' : 'Перечитать раздел'}
          </Button>
        </>
      }
    >
      <p>
        В разделе «{sectionNames[section]}» уже сохранены другие изменения. Ваш черновик пока не
        записан.
      </p>
      <p>
        Перечитывание заменит ваши несохранённые правки этого раздела актуальными данными. Можно
        вернуться к черновику и скопировать нужный текст перед перечитыванием.
      </p>
    </Modal>
  );
}
