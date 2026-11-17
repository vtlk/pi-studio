import { useEffect, useState } from 'react';
import type { OnboardingReadiness } from '../../../shared/onboardingReadiness';

/** Native owns bounded checks and their revisions. No renderer timer starts auth or requests permissions. */
export function useReadiness(folder: string | undefined, signature: string) {
  const [state, setState] = useState<OnboardingReadiness>();
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!window.studio || !folder) return;
    let active = true,
      reading = false,
      forced = false;
    const refresh = async (force = false) => {
      if (reading) {
        forced ||= force;
        return;
      }
      reading = true;
      try {
        const next = await window.studio!.getOnboardingReadiness({ folder, refresh: force });
        if (active && next.folder === folder) {
          setState((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
          setError(false);
        }
      } catch {
        if (active) setError(true);
      } finally {
        reading = false;
        if (active && forced) {
          forced = false;
          void refresh(true);
        }
      }
    };
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 2000);
    const focus = () => void refresh(true);
    window.addEventListener('focus', focus);
    window.addEventListener('pistudio:onboarding-refresh', focus);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', focus);
      window.removeEventListener('pistudio:onboarding-refresh', focus);
    };
  }, [folder, signature]);
  return { state: state?.folder === folder ? state : undefined, error };
}
