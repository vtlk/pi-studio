import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
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
  useTranslation(undefined, { i18n });
  const [value, setValue] = useState(name);
  return (
    <Modal
      title={name ? t('TeamNameDialog.renameTeam') : t('AgentList.createTeam')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('TeamNameDialog.cancel')}</Button>
          <Button
            kind="primary"
            disabled={!value.trim()}
            onClick={() => {
              onSave(value.trim());
              onClose();
            }}
          >
            {name ? t('TeamNameDialog.save') : t('TeamNameDialog.create')}
          </Button>
        </>
      }
    >
      <label className="field-label">
        {t('TeamNameDialog.teamName')}
        <input
          autoFocus
          aria-label={t('TeamNameDialog.teamName')}
          maxLength={500}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
    </Modal>
  );
}
