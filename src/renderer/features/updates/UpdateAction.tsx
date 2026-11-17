import { t, i18n } from '../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { Button, IconButton } from '@/shared/ui';
import { Modal } from '@/shared/ui/Modal';
import { useUpdates } from './Updates';
import './updates.css';

export function UpdateAction() {
  useTranslation(undefined, { i18n });
  const { state, show } = useUpdates();
  const startupProblem =
    state?.startup && ['restored', 'recovery-required'].includes(state.startup.phase);
  if (!state?.offer && !startupProblem && !state?.maintenanceError) return null;
  const downloading = state.phase === 'downloading' && !!state.offer;
  const progress =
    state.offer && state.offer.bytes > 0
      ? Math.min(1, Math.max(0, (state.downloaded ?? 0) / state.offer.bytes))
      : 0;
  const percent = new Intl.NumberFormat(i18n.resolvedLanguage, {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(progress);
  return (
    <IconButton
      title={
        state?.maintenanceError
          ? t('UpdateAction.temporaryUpdateFilesRetainedDetails')
          : downloading
            ? `${t('UpdateAction.downloadingUpdate')} ${percent}`
            : state?.offer
              ? t('UpdateAction.versionAvailableUpdate', { value1: state.offer.version })
              : t('UpdateAction.updateIncompleteDetails')
      }
      onClick={show}
    >
      {downloading ? (
        <span
          className="update-download-progress"
          role="progressbar"
          aria-label={t('UpdateAction.updateDownload')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle className="update-download-track" cx={12} cy={12} r={9} strokeWidth={2} />
            <circle
              cx={12}
              cy={12}
              r={9}
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              pathLength={100}
              strokeDasharray={100}
              strokeDashoffset={100 - progress * 100}
              opacity={progress > 0 ? 1 : 0}
              transform="rotate(-90 12 12)"
            />
          </svg>
        </span>
      ) : (
        <Download size={18} />
      )}
    </IconButton>
  );
}
export function UpdateDialog() {
  useTranslation(undefined, { i18n });
  const { state, open, frozen, hide, request, manual, check } = useUpdates();
  if (!open || !state) return null;
  if (!state.offer || state.maintenanceError) {
    const message =
      state.maintenanceError ??
      state.startup?.message ??
      (manual
        ? state.phase === 'checking'
          ? t('UpdateAction.checkingForUpdates')
          : state.phase === 'error'
            ? (state.message ?? t('UpdateAction.couldNotCheckForUpdates'))
            : t('UpdateAction.versionIsUpToDate', { value1: state.currentVersion })
        : undefined);
    if (!message) return null;
    return (
      <div data-update-dialog>
        <Modal
          title={t('UpdateAction.piStudioUpdate')}
          onClose={hide}
          dismissible={!frozen}
          footer={
            !frozen ? (
              <>
                <Button onClick={hide}>
                  {state.phase === 'checking' ? t('UpdateAction.hide') : t('UpdateAction.ok')}
                </Button>
                {state.maintenanceError && (
                  <Button onClick={request}>{t('UpdateAction.retryCleanup')}</Button>
                )}
                {manual && !state.maintenanceError && state.phase === 'error' && (
                  <Button onClick={check}>{t('StartupGate.retry')}</Button>
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
      ? t('UpdateAction.downloadingUpdate')
      : state.phase === 'verifying'
        ? t('UpdateAction.verifyingPackage')
        : state.phase === 'checking'
          ? t('UpdateAction.checkingForUpdates')
          : '');
  const size = new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 1 }).format(
    state.offer.bytes / 1024 ** 2,
  );
  return (
    <div data-update-dialog>
      <Modal
        title={t('UpdateAction.piStudioUpdate')}
        onClose={hide}
        dismissible={!frozen}
        footer={
          <>
            {!frozen && (
              <Button onClick={hide}>
                {busy ? t('UpdateAction.hide') : t('UpdateAction.later')}
              </Button>
            )}
            {!busy && (
              <Button kind="primary" onClick={manual && state.phase === 'error' ? check : request}>
                {state.phase === 'error'
                  ? manual
                    ? t('UpdateAction.checkAgain')
                    : t('StartupGate.retry')
                  : t('UpdateAction.update')}
              </Button>
            )}
          </>
        }
      >
        <p>
          {t('UpdateAction.version')}
          {state.currentVersion} → <strong>{state.offer.version}</strong> · {size}{' '}
          {t('UpdateAction.mb')}
        </p>
        {state.offer.notes && <div className="update-release-notes">{state.offer.notes}</div>}
        {state.phase === 'downloading' && (
          <progress
            aria-label={t('UpdateAction.updateDownload')}
            value={state.downloaded ?? 0}
            max={state.offer.bytes}
          />
        )}
        {message && <p role={state.phase === 'error' ? 'alert' : 'status'}>{message}</p>}
      </Modal>
    </div>
  );
}
