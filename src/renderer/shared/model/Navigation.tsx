import { NavigationContext } from './Navigation.context';
import { useContext, useRef, useState, type ReactNode } from 'react';

export type Page = 'project' | 'projects' | 'agents' | 'settings' | 'onboarding';
function useNavigationState() {
  const [page, updatePage] = useState<Page>('projects');
  const projectsPage = useRef<'project' | 'projects'>('projects');
  const setPage = (next: Page) => {
    if (next === 'project' || next === 'projects') projectsPage.current = next;
    updatePage(next);
  };
  const openProjects = () => setPage(projectsPage.current);
  const [settingsSection, setSettingsSection] = useState('workspace');
  const openSettings = (section: string) => {
    setSettingsSection(section);
    setPage('settings');
  };
  return {
    page,
    setPage,
    navigate: setPage,
    openProjects,
    settingsSection,
    setSettingsSection,
    openSettings,
  };
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
