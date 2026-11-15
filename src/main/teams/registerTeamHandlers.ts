import { handleDesktopInvoke } from '../ipc/desktopInvoke.ts';
import { dialog, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { lstat, readFile } from 'node:fs/promises';
import { atomicFile } from '../storage/files';
import type { StudioService } from '../storage/StudioStore';
import type { RunHost } from '../pi/RunHost';
import type { Resource } from '../../shared/resources';
import type { Connection } from '../../shared/connections';
import { desktopChannels } from '../../shared/contracts';
import type { TeamPackageRequest } from '../../shared/teamPackage';
import { encodePackage, packageLimit } from './packageCodec';
import { exportTeam } from './exportTeam';
import { importTeam } from './importTeam';
import { listImports } from './importState';
import { handoffTeamImport } from './handoffTeamImport';

export function registerTeamHandlers(
  service: StudioService,
  setup: RunHost,
  caller: (event: IpcMainInvokeEvent) => BrowserWindow,
) {
  const scoped = async (folder: string) => {
    const store = await service.load();
    if (store.folder !== folder) throw new Error('Папка студии изменилась.');
    return store;
  };
  handleDesktopInvoke(
    desktopChannels.exportAgentTeam,
    async (event, request: TeamPackageRequest) => {
      const window = caller(event);
      const name = await service.serialize(async () => {
        const store = await scoped(request.folder);
        const team = store.agentCatalog().teams.find((team) => team.id === request.teamId);
        if (!team) throw new Error('Команда отсутствует.');
        return team.name.replace(/[/\\:]/g, '-');
      });
      const result = await dialog.showSaveDialog(window, {
        title: 'Экспорт команды агентов',
        defaultPath: `${name}.pistudio-team`,
        filters: [{ name: 'Команда Pi Studio', extensions: ['pistudio-team'] }],
      });
      if (result.canceled || !result.filePath) return null;
      const data = await service.serialize(async () => {
        const store = await scoped(request.folder);
        const sections = store.bootstrap().sections;
        return exportTeam(
          store.agentCatalog(),
          request.teamId,
          sections.resources as Resource[],
          sections.connections as Connection[],
        );
      });
      await atomicFile(result.filePath, encodePackage(data));
      return {
        requirements: [
          ...data.manifest.requirements,
          ...data.manifest.resources.flatMap((resource) => resource.requirements),
        ],
      };
    },
  );
  handleDesktopInvoke(desktopChannels.importAgentTeam, async (event, folder: string) => {
    const window = caller(event);
    await service.serialize(() => scoped(folder));
    const result = await dialog.showOpenDialog(window, {
      title: 'Импорт команды агентов',
      properties: ['openFile'],
      filters: [{ name: 'Команда Pi Studio', extensions: ['pistudio-team'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    if ((await lstat(result.filePaths[0])).size > packageLimit)
      throw new Error('Архив команды превышает 64 МБ.');
    const bytes = await readFile(result.filePaths[0]);
    const report = await service.serialize(async () => importTeam(await scoped(folder), bytes));
    return handoffTeamImport(service, setup, folder, report.id);
  });
  handleDesktopInvoke(desktopChannels.listTeamImports, async (event, folder: string) => {
    caller(event);
    return service.serialize(async () => listImports(await scoped(folder)));
  });
  handleDesktopInvoke(
    desktopChannels.continueTeamImport,
    async (event, request: { folder: string; id: string }) => {
      caller(event);
      return handoffTeamImport(service, setup, request.folder, request.id);
    },
  );
}
