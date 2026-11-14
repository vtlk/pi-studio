import { useContext, type ReactNode } from 'react';
import { WorkspaceContext } from './Workspace.context';
import type { useDemoWorkspaceState } from './useDemoWorkspaceState';
import type { useNativeWorkspaceState } from './useNativeWorkspaceState';

export type WorkspaceContextValue =
  | ReturnType<typeof useNativeWorkspaceState>
  | (ReturnType<typeof useDemoWorkspaceState> & { trashProjects: never[]; busy: boolean })
  | null;
export function WorkspaceProvider({
  children,
  useWorkspaceState,
}: {
  children: ReactNode;
  useWorkspaceState: () => NonNullable<WorkspaceContextValue>;
}) {
  const value = useWorkspaceState();
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('WorkspaceProvider is missing');
  return value;
}
