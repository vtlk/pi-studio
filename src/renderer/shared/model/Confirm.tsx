import { t, i18n } from '../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { ConfirmContext } from './Confirm.context';
import { useContext, useState, type ReactNode } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui';

interface Confirmation {
  title: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: () => void;
}
export type ConfirmContextValue = { confirm: (request: Confirmation) => void } | null;
export function ConfirmProvider({ children }: { children: ReactNode }) {
  useTranslation(undefined, { i18n });
  const [pending, setPending] = useState<Confirmation | null>(null);
  return (
    <ConfirmContext.Provider value={{ confirm: setPending }}>
      {children}
      {pending && (
        <Modal
          alert
          title={pending.title}
          onClose={() => setPending(null)}
          footer={
            <>
              <Button onClick={() => setPending(null)}>{t('TeamNameDialog.cancel')}</Button>
              <Button
                kind="primary"
                onClick={() => {
                  const action = pending.onConfirm;
                  setPending(null);
                  action();
                }}
              >
                {pending.confirmLabel ?? t('McpSecretsDialog.delete')}
              </Button>
            </>
          }
        >
          <p>{pending.description ?? t('Confirm.deleteTheSelectedItem')}</p>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}
export function useConfirm() {
  useTranslation(undefined, { i18n });
  const value = useContext(ConfirmContext);
  if (!value) throw new Error('ConfirmProvider is missing');
  return value;
}
