import { LaunchContext } from './Launch.context';
import { useContext, useEffect, useState, type ReactNode } from 'react';

export type Dialog = {
  title: string;
  kind: 'new-project' | 'prompt';
  description?: string;
} | null;
function useLaunchState() {
  const [dialog, setDialog] = useState<Dialog>(null);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDialog(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  return { dialog, setDialog };
}
export type LaunchContextValue = ReturnType<typeof useLaunchState> | null;
export function LaunchProvider({ children }: { children: ReactNode }) {
  return <LaunchContext.Provider value={useLaunchState()}>{children}</LaunchContext.Provider>;
}
export function useLaunch() {
  const value = useContext(LaunchContext);
  if (!value) throw new Error('LaunchProvider is missing');
  return value;
}
