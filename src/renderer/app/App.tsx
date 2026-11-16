import { Fragment, type ComponentType, type ReactNode } from 'react';
import { StorageProvider } from '@/shared/storage/Storage';
import { ConfirmProvider } from '@/shared/model/Confirm';
import { NavigationProvider, useNavigation } from '@/shared/model/Navigation';
import { NoticeProvider } from '@/shared/model/Notice';
import { LaunchProvider } from '@/features/launch/model/Launch';
import { TeamTransfersProvider } from '@/features/agents/model/TeamTransfers';
import { AgentProfilesProvider } from '@/features/agents/model/AgentProfiles';
import { DialogView } from '@/features/launch/ui/DialogView';
import { ProjectView } from '@/features/project/ui/ProjectView';
import { ProjectsView } from '@/features/project/ui/ProjectsView';
import { AgentsView } from '@/features/agents/ui/AgentsView';
import { SettingsView } from '@/features/settings/ui/SettingsView';
import { Topbar } from './layout/Topbar';
import { TooltipProvider } from '@/shared/ui/Tooltip';
import { WorkspaceProvider, type WorkspaceContextValue } from '@/features/project/model/Workspace';
import { ConnectionsProvider } from '@/features/connections/model/Connections';
import { ResourcesProvider } from '@/features/resources/model/Resources';
import { StartupGate } from '@/features/startup/StartupGate';
import { LegacyTemplateCleanup } from '@/features/settings/ui/LegacyTemplateCleanup';
import { RunFailureNotice } from '@/features/launch/ui/RunFailureNotice';
import { UpdateBootstrap } from '@/features/updates/UpdateBootstrap';
import { UpdatesProvider } from '@/features/updates/Updates';
import { UpdateWorkspace } from '@/features/updates/UpdateWorkspace';

const pages = {
  project: ProjectView,
  projects: ProjectsView,
  agents: AgentsView,
  settings: SettingsView,
};
function StudioShell() {
  const { page } = useNavigation();
  const Page = pages[page];
  return (
    <div className="app-shell">
      <LegacyTemplateCleanup />
      <main className="main-shell">
        <Topbar />
        <RunFailureNotice />
        <div className="main-scroll">
          <Page />
        </div>
      </main>
      <DialogView />
    </div>
  );
}
interface AppProps {
  useWorkspaceState: () => NonNullable<WorkspaceContextValue>;
  ExtraProviders?: ComponentType<{ children: ReactNode }>;
  defaults?: {
    agents: import('../../shared/studio').Agent[];
    connections: import('../../shared/connections').Connection[];
    resources: import('../../shared/resources').Resource[];
  };
}
export default function App({ useWorkspaceState, ExtraProviders = Fragment, defaults }: AppProps) {
  return (
    <UpdateBootstrap>
      {(initial) => (
        <TooltipProvider>
          <StorageProvider>
            <NavigationProvider>
              <NoticeProvider>
                <ConfirmProvider>
                  <ConnectionsProvider initial={defaults?.connections}>
                    <ResourcesProvider initial={defaults?.resources}>
                      <AgentProfilesProvider initial={defaults?.agents}>
                        <WorkspaceProvider useWorkspaceState={useWorkspaceState}>
                          <UpdatesProvider initial={initial}>
                            <ExtraProviders>
                              <LaunchProvider>
                                <UpdateWorkspace>
                                  <TeamTransfersProvider>
                                    <StartupGate>
                                      <StudioShell />
                                    </StartupGate>
                                  </TeamTransfersProvider>
                                </UpdateWorkspace>
                              </LaunchProvider>
                            </ExtraProviders>
                          </UpdatesProvider>
                        </WorkspaceProvider>
                      </AgentProfilesProvider>
                    </ResourcesProvider>
                  </ConnectionsProvider>
                </ConfirmProvider>
              </NoticeProvider>
            </NavigationProvider>
          </StorageProvider>
        </TooltipProvider>
      )}
    </UpdateBootstrap>
  );
}
