import { t, i18n } from '../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { getStudioApi } from '@/shared/desktopApi';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { StorageSection, StudioBootstrap } from '../../../shared/storage';
import { StorageContext } from './Storage.context';
import { Button } from '../ui';
import { StartupScreen } from '../ui/StartupScreen';
import { StorageConflict } from './StorageConflict';
import { PersistenceQueue } from './persistenceQueue';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Hydration completes before feature providers mount, so defaults cannot overwrite saved data. */
export function StorageProvider({ children }: { children: ReactNode }) {
  useTranslation(undefined, { i18n });
  const [bootstrap, setBootstrap] = useState<StudioBootstrap | null>(null);
  const [ready, setReady] = useState(!window.studio);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [recentlySaved, setRecentlySaved] = useState(false);
  const successTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const successEpoch = useRef(0);
  const mounted = useRef(true);
  const clearSaveConfirmation = useCallback(() => {
    successEpoch.current++;
    clearTimeout(successTimer.current);
    if (mounted.current) setRecentlySaved(false);
  }, []);
  const showSaveConfirmation = useCallback(() => {
    if (!mounted.current) return;
    const epoch = ++successEpoch.current;
    clearTimeout(successTimer.current);
    setRecentlySaved(true);
    successTimer.current = setTimeout(() => {
      if (mounted.current && successEpoch.current === epoch) setRecentlySaved(false);
    }, 3000);
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearSaveConfirmation();
    };
  }, [clearSaveConfirmation]);
  const [revision, setRevision] = useState(0);
  const [conflict, setConflict] = useState<{
    key: StorageSection;
  } | null>(null);
  const [showConflict, setShowConflict] = useState(false);
  const [reloading, setReloading] = useState(false);
  const currentFolder = useRef('');
  const refreshing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [draftFolder, setDraftFolder] = useState('');
  const [queue] = useState(
    () =>
      new PersistenceQueue({
        write: (key, edit) =>
          getStudioApi().saveSection(key, edit.value, {
            folder: currentFolder.current,
            base: edit.base,
          }),
        saved: (key, value) => {
          setBootstrap((previous) =>
            previous
              ? {
                  ...previous,
                  sections: { ...previous.sections, [key]: value },
                }
              : previous,
          );
          setConflict((previous) => (previous?.key === key ? null : previous));
        },
        conflict: (key) => {
          clearSaveConfirmation();
          setConflict({ key });
          setShowConflict(true);
          setError(t('Storage.settingsHaveAlreadyChangedInPiYour'));
        },
        error: (error) => {
          clearSaveConfirmation();
          setError(t('Storage.notSaved', { value1: message(error) }));
        },
        changed: (pending) => {
          clearSaveConfirmation();
          setSaving(pending);
        },
        settled: () => setError(''),
        persisted: showSaveConfirmation,
      }),
  );
  const isPending = useCallback((section: StorageSection) => queue.has(section), [queue]);

  const load = useCallback(async () => {
    try {
      const data = await getStudioApi().loadStudio();
      currentFolder.current = data.folder;
      clearSaveConfirmation();
      setBootstrap(data);
      setReady(true);
      setError('');
    } catch (error) {
      setError(message(error));
    }
  }, [clearSaveConfirmation]);
  useEffect(() => {
    if (window.studio) void load();
  }, [load]);

  const flush = useCallback(() => queue.flush(), [queue]);
  const folder = bootstrap?.folder;
  useEffect(() => {
    if (!window.studio || !ready || !folder) return;
    const refresh = async () => {
      if (refreshing.current || queue.writing || queue.size) return;
      refreshing.current = true;
      try {
        const data = await getStudioApi().loadStudio();
        if (data.folder !== folder || queue.writing || queue.size) return;
        setBootstrap((previous) =>
          previous && JSON.stringify(previous.sections) !== JSON.stringify(data.sections)
            ? { ...previous, sections: data.sections }
            : previous,
        );
      } catch {
        /* Existing explicit load/save errors remain visible; background reads are retried. */
      } finally {
        refreshing.current = false;
      }
    };
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 2000);
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [ready, folder, queue]);
  const save = useCallback(
    (key: StorageSection, value: unknown, base: unknown) => {
      if (!window.studio) return;
      queue.enqueue(key, value, base);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 250);
    },
    [flush, queue],
  );
  const reloadConflict = async () => {
    if (!conflict || !window.studio || reloading) return;
    const key = conflict.key;
    const draft = queue.get(key);
    setReloading(true);
    try {
      const data = await window.studio.loadStudio();
      if (data.folder !== currentFolder.current || queue.get(key) !== draft)
        throw new Error(t('Storage.dataChangedDuringReloadTryAgain'));
      if (!queue.discard(key, draft)) throw new Error(t('Storage.dataChangedDuringReloadTryAgain'));
      setBootstrap((previous) =>
        previous
          ? { ...previous, sections: { ...previous.sections, [key]: data.sections[key] } }
          : previous,
      );
      setConflict(null);
      setShowConflict(false);
      setError('');
      setSaving(queue.size > 0);
      void flush();
    } catch (error) {
      setError(message(error));
    } finally {
      setReloading(false);
    }
  };
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!queue.size) return;
      event.preventDefault();
      event.returnValue = '';
      void flush();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [flush, queue]);

  const changeStudio = async (folder?: string) => {
    if (!window.studio) return;
    await flush();
    if (queue.size || queue.writing) {
      setError(t('Storage.waitForTheCurrentStudioToFinish'));
      return;
    }
    try {
      const data =
        folder === undefined
          ? await window.studio.chooseStudio()
          : await window.studio.openStudio(folder);
      if (!data) return;
      currentFolder.current = data.folder;
      clearSaveConfirmation();
      setBootstrap(data);
      setReady(true);
      setError('');
      setRevision((value) => value + 1);
    } catch (error) {
      setError(message(error));
    }
  };
  return (
    <StorageContext.Provider
      value={{
        bootstrap,
        isDesktop: !!window.studio,
        saving,
        recentlySaved,
        error,
        chooseStudio: () => changeStudio(),
        openStudio: (folder) => changeStudio(folder),
        save,
        retry: () => {
          if (ready) void flush();
          else void load();
        },
        saveNow: async () => {
          await flush();
          return !queue.size && !queue.writing;
        },
        isPending,
      }}
    >
      {ready ? (
        <div className="studio-root" key={revision}>
          {children}
        </div>
      ) : (
        <StartupScreen message={error || t('Storage.openingStudio')} error={!!error}>
          {error && (
            <>
              <div className="settings-field-row">
                <label className="field-label">
                  {t('Storage.anotherStudioFolder')}
                  <input
                    value={draftFolder}
                    onChange={(event) => setDraftFolder(event.target.value)}
                    placeholder="/Users/…/Pi Studio"
                  />
                </label>
                <Button
                  disabled={!draftFolder.trim()}
                  onClick={() => void changeStudio(draftFolder)}
                >
                  {t('Storage.open')}
                </Button>
              </div>
              <Button onClick={() => void load()}>{t('StartupGate.retry')}</Button>
              <Button onClick={() => void changeStudio()}>{t('SettingsView.chooseFolder')}</Button>
            </>
          )}
        </StartupScreen>
      )}
      {ready && error && (
        <div className="storage-error" role="alert">
          <span>{error}</span>
          {conflict ? (
            <Button onClick={() => setShowConflict(true)}>{t('Storage.reloadSection')}</Button>
          ) : queue.size ? (
            <Button onClick={() => void flush()}>{t('Theme.retrySaving')}</Button>
          ) : (
            <Button onClick={() => setError('')}>{t('TeamTransfers.close')}</Button>
          )}
        </div>
      )}
      {conflict && showConflict && (
        <StorageConflict
          section={conflict.key}
          reloading={reloading}
          onClose={() => setShowConflict(false)}
          onReload={() => void reloadConflict()}
        />
      )}
      {ready && bootstrap?.warnings.length ? (
        <div className="storage-warning" role="status">
          {t('Storage.someProjectsCouldNotBeRead')}
          {bootstrap.warnings.join('; ')}
        </div>
      ) : null}
    </StorageContext.Provider>
  );
}
export { useStorage, useStoredState } from './storageHooks';
