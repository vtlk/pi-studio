import { useState } from 'react';
import { Button } from '@/shared/ui';
import { Modal } from '@/shared/ui/Modal';

export function TeamNameDialog({
  name = '',
  onSave,
  onClose,
}: {
  name?: string;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(name);
  return (
    <Modal
      title={name ? 'Переименовать команду' : 'Создать команду'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button
            kind="primary"
            disabled={!value.trim()}
            onClick={() => {
              onSave(value.trim());
              onClose();
            }}
          >
            {name ? 'Сохранить' : 'Создать'}
          </Button>
        </>
      }
    >
      <label className="field-label">
        Название команды
        <input
          autoFocus
          aria-label="Название команды"
          maxLength={500}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
    </Modal>
  );
}
