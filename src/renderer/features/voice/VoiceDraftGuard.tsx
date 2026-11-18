import { useEffect, useSyncExternalStore } from 'react';
let drafts = 0;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};
/** Recording/transcription owns unsaved input even when its chat is temporarily hidden. */
export function retainVoiceDraft() {
  drafts++;
  emit();
  let retained = true;
  return () => {
    if (retained) {
      retained = false;
      drafts--;
      emit();
    }
  };
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function VoiceDraftGuard() {
  const active = useSyncExternalStore(subscribe, () => drafts > 0);
  useEffect(() => {
    if (!active) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [active]);
  return <span hidden data-unsaved-draft={active || undefined} />;
}
