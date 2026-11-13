import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type { StorageSection, StudioBootstrap } from '../../../shared/storage';
import { StorageContext } from './Storage.context';
import { Button } from '../ui';
import { StartupScreen } from '../ui/StartupScreen';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Hydration completes before feature providers mount, so defaults cannot overwrite saved data. */
export function StorageProvider({ children }: { children: ReactNode }) {
  const [bootstrap, setBootstrap] = useState<StudioBootstrap | null>(null);
  const [ready, setReady] = useState(!window.studio);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const pending = useRef(new Map<StorageSection, unknown>());
  const writing = useRef(false);
  const writeTask = useRef<Promise<void> | null>(null);
  const refreshing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [draftFolder, setDraftFolder] = useState('');
  const isPending = useCallback((section: StorageSection) => pending.current.has(section), []);

  const load = useCallback(async () => {
    try {
      const data = await window.studio!.loadStudio();
      setBootstrap(data);
      setReady(true);
      setError('');
    } catch (error) {
      setError(message(error));
    }
  }, []);
  useEffect(() => {
    if (window.studio) void load();
  }, [load]);

  const flush = useCallback((): Promise<void> => {
    if (writeTask.current) return writeTask.current;
    if (!window.studio || !pending.current.size) return Promise.resolve();
    const task = (async () => {
      writing.current = true;
      setSaving(true);
      try {
        while (pending.current.size) {
          const [key, value] = pending.current.entries().next().value!;
          await window.studio!.saveSection(key, value);
          if (pending.current.get(key) === value) pending.current.delete(key);
        }
        setError('');
      } catch (error) {
        setError(`Не сохранено: ${message(error)}`);
      } finally {
        writing.current = false;
        setSaving(pending.current.size > 0);
      }
    })().finally(() => {
      writeTask.current = null;
    });
    writeTask.current = task;
    return task;
  }, []);
  const folder = bootstrap?.folder;
  useEffect(() => {
    if (!window.studio || !ready || !folder) return;
    const refresh = async () => {
      if (refreshing.current || writing.current || pending.current.size) return;
      refreshing.current = true;
      try {
        const data = await window.studio!.loadStudio();
        if (data.folder !== folder || writing.current || pending.current.size) return;
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
  }, [ready, folder]);
  const save = useCallback(
    (key: StorageSection, value: unknown) => {
      if (!window.studio) return;
      pending.current.set(key, value);
      setSaving(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 250);
    },
    [flush],
  );
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!pending.current.size) return;
      event.preventDefault();
      event.returnValue = '';
      void flush();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [flush]);

  const changeStudio = async (folder?: string) => {
    if (!window.studio) return;
    await flush();
    if (pending.current.size || writing.current) {
      setError('Дождитесь сохранения текущей студии перед сменой папки.');
      return;
    }
    try {
      const data =
        folder === undefined
          ? await window.studio.chooseStudio()
          : await window.studio.openStudio(folder);
      if (!data) return;
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
          return !pending.current.size && !writing.current;
        },
        isPending,
      }}
    >
      {ready ? (
        <div className="studio-root" key={revision}>
          {children}
        </div>
      ) : (
        <StartupScreen message={error || 'Открываем студию…'} error={!!error}>
          {error && (
            <>
              <div className="settings-field-row">
                <label className="field-label">
                  Другая папка студии
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
                  Открыть
                </Button>
              </div>
              <Button onClick={() => void load()}>Повторить</Button>
              <Button onClick={() => void changeStudio()}>Выбрать папку</Button>
            </>
          )}
        </StartupScreen>
      )}
      {ready && error && (
        <div className="storage-error" role="alert">
          <span>{error}</span>
          {pending.current.size ? (
            <Button onClick={() => void flush()}>Повторить сохранение</Button>
          ) : (
            <Button onClick={() => setError('')}>Закрыть</Button>
          )}
        </div>
      )}
      {ready && bootstrap?.warnings.length ? (
        <div className="storage-warning" role="status">
          Не прочитаны некоторые проекты: {bootstrap.warnings.join('; ')}
        </div>
      ) : null}
    </StorageContext.Provider>
  );
}
export function useStorage() {
  const value = useContext(StorageContext);
  if (!value) throw new Error('StorageProvider is missing');
  return value;
}
/** Each feature still owns its state. Only the current value goes to the shared disk writer. */
export function useStoredState<T>(key: StorageSection, initial: T | (() => T)) {
  const { bootstrap, save, isPending } = useStorage();
  const [value, update] = useState<T>(
    () =>
      (bootstrap?.sections[key] as T | undefined) ??
      (typeof initial === 'function' ? (initial as () => T)() : initial),
  );
  const latest = useRef(value);
  const external = bootstrap?.sections[key] as T | undefined;
  useEffect(() => {
    if (
      external === undefined ||
      isPending(key) ||
      JSON.stringify(external) === JSON.stringify(latest.current)
    )
      return;
    queueMicrotask(() => {
      if (!isPending(key)) {
        latest.current = external;
        update(external);
      }
    });
  }, [external, key, isPending]);
  const setValue = useCallback(
    (action: SetStateAction<T>) => {
      const next =
        typeof action === 'function' ? (action as (previous: T) => T)(latest.current) : action;
      latest.current = next;
      update(next);
      save(key, next);
    },
    [key, save],
  );
  return [value, setValue] as const;
}
