import type { Agent } from '@/entities/studio/types';
import { LaunchContext } from './Launch.context';
import { useContext, useEffect, useState, type ReactNode } from 'react';

export type Dialog = {
  title: string;
  kind: 'run' | 'new-project' | 'new-asset' | 'picker' | 'prompt';
  description?: string;
  agentId?: string;
  profile?: Agent;
  projectId?: string;
  outputPath?: string;
  assetType?: 'characters' | 'scenes';
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
  const openRun = (title: string, description?: string, agentId = 'scenes') =>
    setDialog({ title, kind: 'run', description, agentId });
  return { dialog, setDialog, openRun };
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
