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
              <Button onClick={() => setPending(null)}>Отмена</Button>
              <Button
                kind="primary"
                onClick={() => {
                  const action = pending.onConfirm;
                  setPending(null);
                  action();
                }}
              >
                {pending.confirmLabel ?? 'Удалить'}
              </Button>
            </>
          }
        >
          <p>{pending.description ?? 'Удалить выбранный элемент?'}</p>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}
export function useConfirm() {
  const value = useContext(ConfirmContext);
  if (!value) throw new Error('ConfirmProvider is missing');
  return value;
}
