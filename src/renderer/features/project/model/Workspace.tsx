import { useContext, type ReactNode } from 'react';
import { WorkspaceContext } from './Workspace.context';
import { useDemoWorkspaceState } from './useDemoWorkspaceState';
import { useNativeWorkspaceState } from './useNativeWorkspaceState';
import { useStorage } from '@/shared/storage/Storage';

function useWorkspaceState() {
  const { isDesktop } = useStorage();
  const demo = useDemoWorkspaceState();
  const native = useNativeWorkspaceState();
  return isDesktop ? native : { ...demo, trashProjects: [], busy: false };
}
export type WorkspaceContextValue = ReturnType<typeof useWorkspaceState> | null;
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  return (
    <WorkspaceContext.Provider value={useWorkspaceState()}>{children}</WorkspaceContext.Provider>
  );
}
export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('WorkspaceProvider is missing');
  return value;
}
