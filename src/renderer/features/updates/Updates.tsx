import { t, i18n } from '../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { UpdateState } from '../../../shared/updates';
import { useStorage } from '@/shared/storage/Storage';
import { useNavigation } from '@/shared/model/Navigation';
import { useWorkspace } from '@/features/project/model/Workspace';
import { UpdatesContext } from './Updates.context';

function hasTransientDraft() {
  return (
    [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].some(
      (element) => !element.closest('[data-update-dialog]'),
    ) ||
    [...document.querySelectorAll<HTMLInputElement>('input[type="password"]')].some(
      (element) => !!element.value,
    ) ||
    !!document.querySelector('[data-unsaved-draft="true"]')
  );
}
export function UpdatesProvider({
  children,
  initial,
}: {
  children: ReactNode;
  initial?: UpdateState;
}) {
  useTranslation(undefined, { i18n });
  const { saving, error, saveNow, bootstrap } = useStorage();
  const { page, navigate } = useNavigation();
  const { selectedProject, projects, setProjectId } = useWorkspace();
  const [state, setState] = useState<UpdateState | undefined>(initial);
  const [restored, setRestored] = useState<string>();
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const manualSeen = useRef<string | undefined>(undefined);
  const manualPending = useRef(false);
  const current = useRef({
    saving,
    error,
    saveNow,
    page,
    projectId: selectedProject?.id,
    hydrated: !!bootstrap,
    restored,
  });
  current.current = {
    saving,
    error,
    saveNow,
    page,
    projectId: selectedProject?.id,
    hydrated: !!bootstrap,
    restored,
  };
  const startupToken = state?.startup?.token;
  useEffect(() => {
    if (state?.maintenanceError) setOpen(true);
  }, [state?.maintenanceError]);
  useEffect(() => {
    if (!startupToken || restored === startupToken) return;
    const view =
      !state?.startup?.folder || state.startup.folder === bootstrap?.folder
        ? state?.startup?.view
        : undefined;
    if (view?.page === 'project') {
      if (projects.some((project) => project.id === view.projectId)) {
        setProjectId(view.projectId!);
        navigate('project');
      } else navigate('projects');
    } else if (view) navigate(view.page);
    setRestored(startupToken);
    if (state?.startup?.phase === 'restored') setOpen(true);
  }, [startupToken, restored, state?.startup, projects, setProjectId, navigate, bootstrap?.folder]);
  const alive = useRef(true);
  const requestPending = useRef(false);
  useEffect(() => {
    const api = window.studio;
    if (!api) return;
    alive.current = true;
    let reading = false;
    const poll = async () => {
      if (reading) return;
      reading = true;
      try {
        const next = await api.getUpdateState();
        if (!alive.current) return;
        if (next.manualCheckToken && next.manualCheckToken !== manualSeen.current) {
          manualSeen.current = next.manualCheckToken;
          setManual(!['downloading', 'verifying', 'waiting', 'installing'].includes(next.phase));
          setOpen(true);
        }
        setState((previous) =>
          JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
        );
        await api.reportUpdateReadiness({
          // The replacement was inert before its first editable frame: automatic legacy/info
          // dialogs contain no new user draft and must not deadlock startup health.
          saved:
            !current.current.saving &&
            !current.current.error &&
            (next.startup?.phase === 'starting' || !hasTransientDraft()),
          startupToken: next.startup?.token,
          hydrated: current.current.hydrated && current.current.restored === next.startup?.token,
          manualCheckToken: next.manualCheckToken,
        });
      } catch {
        // Background update availability never prevents working in the current installation.
      } finally {
        reading = false;
      }
    };
    void poll();
    // Consent remains active in the background; hidden windows must still flush/ack readiness.
    const timer = setInterval(() => {
      void poll();
    }, 500);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, []);
  const token = state?.prepareToken;
  useEffect(() => {
    const api = window.studio;
    if (!api || !token) return;
    // Keep an authorized installation's error visible after its temporary input lock is released.
    setOpen(true);
    let cancelled = false;
    // The containing app is already inert in this committed render, before flushing begins.
    void (async () => {
      let saved: boolean;
      try {
        saved = !hasTransientDraft() && (await current.current.saveNow()) && !current.current.error;
      } catch {
        saved = false;
      }
      if (cancelled) return;
      await api.reportUpdateReadiness({
        saved,
        token,
        view: { page: current.current.page, projectId: current.current.projectId },
      });
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token]);
  const frozen =
    !!token || (!!state?.startup && !['committed', 'restored'].includes(state.startup.phase));
  return (
    <UpdatesContext.Provider
      value={{
        state,
        frozen,
        open: open || frozen,
        manual,
        show: () => {
          setManual(false);
          setOpen(true);
        },
        hide: () => {
          if (!frozen) {
            setOpen(false);
            setManual(false);
          }
        },
        check: () => {
          const api = window.studio;
          if (!api || manualPending.current) return;
          manualPending.current = true;
          setManual(true);
          setOpen(true);
          setState((previous) =>
            previous ? { ...previous, phase: 'checking', message: undefined } : previous,
          );
          void api
            .checkForUpdates()
            .then(
              (next) => {
                if (alive.current) setState(next);
              },
              () => {
                if (alive.current)
                  setState((previous) =>
                    previous
                      ? {
                          ...previous,
                          phase: 'error',
                          message: t('Updates.couldNotCheckForUpdatesTryAgain'),
                        }
                      : previous,
                  );
              },
            )
            .finally(() => {
              manualPending.current = false;
            });
        },
        request: () => {
          if (!window.studio || requestPending.current) return;
          setManual(false);
          requestPending.current = true;
          void window.studio
            .requestUpdate()
            .catch(() => undefined)
            .finally(() => {
              requestPending.current = false;
            });
        },
      }}
    >
      {children}
    </UpdatesContext.Provider>
  );
}
export function useUpdates() {
  useTranslation(undefined, { i18n });
  const value = useContext(UpdatesContext);
  if (!value) throw new Error('UpdatesProvider is missing');
  return value;
}
