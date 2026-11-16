import { NavigationContext } from './Navigation.context';
import { useContext, useState, type ReactNode } from 'react';

export type Page = 'project' | 'projects' | 'agents' | 'settings';
function useNavigationState() {
  const [page, setPage] = useState<Page>('projects');
  return { page, setPage, navigate: setPage };
}
export type NavigationContextValue = ReturnType<typeof useNavigationState> | null;
export function NavigationProvider({ children }: { children: ReactNode }) {
  return (
    <NavigationContext.Provider value={useNavigationState()}>{children}</NavigationContext.Provider>
  );
}
export function useNavigation() {
  const value = useContext(NavigationContext);
  if (!value) throw new Error('NavigationProvider is missing');
  return value;
}
