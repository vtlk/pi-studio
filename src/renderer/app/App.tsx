import { type ReactNode } from 'react';
import { useStorage } from '@/shared/storage/Storage';
import { StorageProvider } from '@/shared/storage/Storage';
import { ConfirmProvider } from '@/shared/model/Confirm';
import { LibraryProvider } from '@/features/library/model/Library';
import { NavigationProvider, useNavigation } from '@/shared/model/Navigation';
import { NoticeProvider } from '@/shared/model/Notice';
import { LaunchProvider } from '@/features/launch/model/Launch';
import { AgentProfilesProvider } from '@/features/agents/model/AgentProfiles';
import { ProjectProvider } from '@/features/project/model/Project';
import { PlaybackProvider } from '@/features/preview/model/Playback';
import { DialogView } from '@/features/launch/ui/DialogView';
import { ProjectView } from '@/features/project/ui/ProjectView';
import { ProjectsView } from '@/features/project/ui/ProjectsView';
import { LibraryView } from '@/features/library/ui/LibraryView';
import { AgentsView } from '@/features/agents/ui/AgentsView';
import { SettingsView } from '@/features/settings/ui/SettingsView';
import { Topbar } from './layout/Topbar';
import { TooltipProvider } from '@/shared/ui/Tooltip';
import { WorkspaceProvider } from '@/features/project/model/Workspace';
import { ConnectionsProvider } from '@/features/connections/model/Connections';
import { EditorProvider } from '@/features/editor/model/Editor';
import { ResourcesProvider } from '@/features/resources/model/Resources';
import { StartupGate } from '@/features/startup/StartupGate';

const pages = {
  project: ProjectView,
  projects: ProjectsView,
  library: LibraryView,
  agents: AgentsView,
  settings: SettingsView,
};
function StudioShell() {
  const { page } = useNavigation();
  const Page = pages[page];
  return (
    <div className="app-shell">
      <main className="main-shell">
        <Topbar />
        <div className="main-scroll">
          <Page />
        </div>
      </main>
      <DialogView />
    </div>
  );
}
function PrototypeProviders({ children }: { children: ReactNode }) {
  const { isDesktop } = useStorage();
  if (isDesktop) return children;
  return (
    <EditorProvider>
      <ProjectProvider>
        <PlaybackProvider>{children}</PlaybackProvider>
      </ProjectProvider>
    </EditorProvider>
  );
}
export default function App() {
  return (
    <StartupGate>
      <StorageProvider>
        <TooltipProvider>
          <NavigationProvider>
            <NoticeProvider>
              <ConfirmProvider>
                <ConnectionsProvider>
                  <ResourcesProvider>
                    <AgentProfilesProvider>
                      <WorkspaceProvider>
                        <PrototypeProviders>
                          <LibraryProvider>
                            <LaunchProvider>
                              <StudioShell />
                            </LaunchProvider>
                          </LibraryProvider>
                        </PrototypeProviders>
                      </WorkspaceProvider>
                    </AgentProfilesProvider>
                  </ResourcesProvider>
                </ConnectionsProvider>
              </ConfirmProvider>
            </NoticeProvider>
          </NavigationProvider>
        </TooltipProvider>
      </StorageProvider>
    </StartupGate>
  );
}
