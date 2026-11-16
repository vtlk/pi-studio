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
    )
  );
}
export function UpdatesProvider({ children }: { children: ReactNode }) {
  const { saving, error, saveNow } = useStorage();
  const { page } = useNavigation();
  const { selectedProject } = useWorkspace();
  const [state, setState] = useState<UpdateState>();
  const [open, setOpen] = useState(false);
  const current = useRef({ saving, error, saveNow, page, projectId: selectedProject?.id });
  current.current = { saving, error, saveNow, page, projectId: selectedProject?.id };
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
        setState((previous) =>
          JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
        );
        await api.reportUpdateReadiness({
          saved: !current.current.saving && !current.current.error && !hasTransientDraft(),
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
  const frozen = !!token;
  return (
    <UpdatesContext.Provider
      value={{
        state,
        frozen,
        open: open || frozen,
        show: () => setOpen(true),
        hide: () => {
          if (!frozen) setOpen(false);
        },
        request: () => {
          if (!window.studio || requestPending.current) return;
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
  const value = useContext(UpdatesContext);
  if (!value) throw new Error('UpdatesProvider is missing');
  return value;
}
