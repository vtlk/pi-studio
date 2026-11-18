import { shell, type IpcMainInvokeEvent } from 'electron';
import { t } from '../../shared/i18n/index.ts';
import { desktopChannels } from '../../shared/contracts.ts';
import type { StudioService } from '../storage/StudioStore.ts';
import type { ModelConnections } from '../pi/ModelConnections.ts';
import type { StudioResources } from '../pi/StudioResources.ts';
import type { ComputerSupport } from '../computer/ComputerSupport.ts';
import type { BrowserSupport } from '../browser/BrowserSupport.ts';
import type { ImageConnections } from '../images/ImageConnections.ts';
import type { Startup } from '../pi/Startup.ts';
import type { Connection } from '../../shared/connections.ts';
import type { Resource } from '../../shared/resources.ts';
import type { TeamImportReport } from '../../shared/teamPackage.ts';
import {
  handleDesktopInvoke,
  desktopInvocationGate,
  desktopStartupAdmission,
} from '../ipc/desktopInvoke.ts';
import { hasWindowsTerminal } from '../pi/windowsTerminal.ts';
import { findGit } from '../pi/git.ts';
import { listImports } from '../teams/importState.ts';
import { OnboardingReadiness } from './OnboardingReadiness.ts';
import { observeTeamMcpReadiness } from './observeTeamMcpReadiness.ts';

export function registerOnboardingHandlers(
  service: StudioService,
  dependencies: {
    modelConnections: ModelConnections;
    resources: StudioResources;
    computer: ComputerSupport;
    browser: BrowserSupport;
    imageConnections: ImageConnections;
    startup: Startup;
  },
  caller: (event: IpcMainInvokeEvent) => unknown,
) {
  let imports: { signature: string; reports: TeamImportReport[] } | undefined;
  const readiness = new OnboardingReadiness({
    scope: (folder) =>
      service.serialize(async () => {
        const store = await service.load();
        if (folder !== store.folder) throw new Error(t('registerTeamHandlers.studioFolderChanged'));
        const catalog = store.agentCatalog(),
          sections = store.bootstrap().sections;
        const signature = JSON.stringify([folder, catalog.teams.map((team) => team.id)]);
        if (imports?.signature !== signature)
          imports = { signature, reports: await listImports(store) };
        return {
          folder,
          ...catalog,
          connections: sections.connections as Connection[],
          resources: sections.resources as Resource[],
          reports: imports.reports,
          imageTool: sections.imageTool as { connectionId?: string; modelId?: string } | undefined,
        };
      }),
    connection: async (folder, connectionId) =>
      (await dependencies.modelConnections.status({ folder, connectionId })).status,
    probeMcp: (folder, id) => dependencies.resources.onboardingProbe(id, folder),
    checkMcp: async (folder, id) => (await dependencies.resources.check(id, folder)).status,
    computer: () => dependencies.computer.state(),
    browser: () => dependencies.browser.state(),
    imageRevision: (folder, connectionId) =>
      dependencies.imageConnections.revision({ folder, connectionId }),
    imageStatus: (folder, connectionId) =>
      dependencies.imageConnections.status({ folder, connectionId }),
    checkImages: (folder, connectionId) =>
      dependencies.imageConnections.check({ folder, connectionId }),
    terminal: hasWindowsTerminal,
    terminalRequired: false,
    git: async () => !!(await findGit()),
    gitBashRequired: false,
    windows: process.platform === 'win32',
    runtimeReady: () => {
      try {
        desktopStartupAdmission.assertAllowed(desktopChannels.checkResource);
        return dependencies.startup.read().phase === 'ready';
      } catch {
        return false;
      }
    },
    run: (action) => desktopInvocationGate.invoke(action),
    observeTeam: (folder, id, ready) => observeTeamMcpReadiness(service, folder, id, ready),
  });
  handleDesktopInvoke(
    desktopChannels.getOnboardingReadiness,
    (event, request: { folder: string; refresh?: boolean }) => {
      caller(event);
      if (
        !request ||
        typeof request.folder !== 'string' ||
        (request.refresh !== undefined && typeof request.refresh !== 'boolean')
      )
        throw new Error(t('registerTeamHandlers.studioFolderChanged'));
      return readiness.read(request.folder, request.refresh);
    },
  );
  handleDesktopInvoke(desktopChannels.openTerminalDownload, async (event) => {
    caller(event);
    if (process.platform === 'win32')
      await shell.openExternal(
        'https://github.com/microsoft/terminal#installing-and-running-windows-terminal',
      );
  });
  handleDesktopInvoke(desktopChannels.openGitDownload, async (event) => {
    caller(event);
    await shell.openExternal('https://git-scm.com/install/');
  });
  return readiness;
}
