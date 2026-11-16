import { Download } from 'lucide-react';
import { Button, IconButton } from '@/shared/ui';
import { Modal } from '@/shared/ui/Modal';
import { useUpdates } from './Updates';
import './updates.css';

export function UpdateAction() {
  const { state, show } = useUpdates();
  const startupProblem =
    state?.startup && ['restored', 'recovery-required'].includes(state.startup.phase);
  if (!state?.offer && !startupProblem && !state?.maintenanceError) return null;
  return (
    <IconButton
      title={
        state?.maintenanceError
          ? 'Временные файлы обновления сохранены — сведения'
          : state?.offer
            ? `Доступна версия ${state.offer.version} — обновить`
            : 'Обновление не завершено — сведения'
      }
      onClick={show}
    >
      <Download size={18} />
    </IconButton>
  );
}
export function UpdateDialog() {
  const { state, open, frozen, hide, request, manual, check } = useUpdates();
  if (!open || !state) return null;
  if (!state.offer || state.maintenanceError) {
    const message =
      state.maintenanceError ??
      state.startup?.message ??
      (manual
        ? state.phase === 'checking'
          ? 'Проверяем обновления…'
          : state.phase === 'error'
            ? (state.message ?? 'Не удалось проверить обновления.')
            : `Установлена актуальная версия ${state.currentVersion}`
        : undefined);
    if (!message) return null;
    return (
      <div data-update-dialog>
        <Modal
          title="Обновление Pi Studio"
          onClose={hide}
          dismissible={!frozen}
          footer={
            !frozen ? (
              <>
                <Button onClick={hide}>{state.phase === 'checking' ? 'Скрыть' : 'Понятно'}</Button>
                {state.maintenanceError && <Button onClick={request}>Повторить очистку</Button>}
                {manual && !state.maintenanceError && state.phase === 'error' && (
                  <Button onClick={check}>Повторить</Button>
                )}
              </>
            ) : undefined
          }
        >
          <p
            role={
              state.maintenanceError ||
              state.phase === 'error' ||
              state.startup?.phase === 'restored' ||
              state.startup?.phase === 'recovery-required'
                ? 'alert'
                : 'status'
            }
          >
            {message}
          </p>
        </Modal>
      </div>
    );
  }
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
          ? 'Проверяем обновления…'
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
              <Button kind="primary" onClick={manual && state.phase === 'error' ? check : request}>
                {state.phase === 'error'
                  ? manual
                    ? 'Повторить проверку'
                    : 'Повторить'
                  : 'Обновить'}
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
