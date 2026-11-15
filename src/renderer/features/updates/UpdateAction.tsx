import { Download } from 'lucide-react';
import { Button, IconButton } from '@/shared/ui';
import { Modal } from '@/shared/ui/Modal';
import { useUpdates } from './Updates';
import './updates.css';

export function UpdateAction() {
  const { state, show } = useUpdates();
  if (!state?.offer) return null;
  return (
    <IconButton title={`Доступна версия ${state.offer.version} — обновить`} onClick={show}>
      <Download size={18} />
    </IconButton>
  );
}
export function UpdateDialog() {
  const { state, open, frozen, hide, request } = useUpdates();
  if (!open || !state?.offer) return null;
  const busy = ['downloading', 'verifying', 'waiting', 'installing', 'checking'].includes(
    state.phase,
  );
  const message =
    state.message ??
    (state.phase === 'downloading'
      ? 'Скачиваем обновление…'
      : state.phase === 'verifying'
        ? 'Проверяем пакет…'
        : state.phase === 'checking'
          ? 'Проверяем доступность…'
          : '');
  const size = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(
    state.offer.bytes / 1024 ** 2,
  );
  return (
    <div data-update-dialog>
      <Modal
        title="Обновление Pi Studio"
        onClose={hide}
        dismissible={!frozen}
        footer={
          <>
            {!frozen && <Button onClick={hide}>{busy ? 'Скрыть' : 'Позже'}</Button>}
            {!busy && (
              <Button kind="primary" onClick={request}>
                {state.phase === 'error' ? 'Повторить' : 'Обновить'}
              </Button>
            )}
          </>
        }
      >
        <p>
          Версия {state.currentVersion} → <strong>{state.offer.version}</strong> · {size} МБ
        </p>
        {state.offer.notes && <div className="update-release-notes">{state.offer.notes}</div>}
        {state.phase === 'downloading' && (
          <progress
            aria-label="Загрузка обновления"
            value={state.downloaded ?? 0}
            max={state.offer.bytes}
          />
        )}
        {message && <p role={state.phase === 'error' ? 'alert' : 'status'}>{message}</p>}
      </Modal>
    </div>
  );
}
