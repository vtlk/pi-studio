import { useContext, type ReactNode } from 'react';
import { WorkspaceContext } from './Workspace.context';
import { useDemoWorkspaceState } from './useDemoWorkspaceState';
import { useNativeWorkspaceState } from './useNativeWorkspaceState';
import { useStorage } from '@/shared/storage/Storage';

export type WorkspaceContextValue =
  | ReturnType<typeof useNativeWorkspaceState>
  | (ReturnType<typeof useDemoWorkspaceState> & { trashProjects: never[]; busy: boolean })
  | null;
function NativeWorkspace({ children }: { children: ReactNode }) {
  return (
    <WorkspaceContext.Provider value={useNativeWorkspaceState()}>
      {children}
    </WorkspaceContext.Provider>
  );
}
function DemoWorkspace({ children }: { children: ReactNode }) {
  return (
    <WorkspaceContext.Provider
      value={{ ...useDemoWorkspaceState(), trashProjects: [], busy: false }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { isDesktop } = useStorage();
  return isDesktop ? (
    <NativeWorkspace>{children}</NativeWorkspace>
  ) : (
    <DemoWorkspace>{children}</DemoWorkspace>
  );
}
export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('WorkspaceProvider is missing');
  return value;
}
