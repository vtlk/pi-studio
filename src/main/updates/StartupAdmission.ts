import { desktopChannels as c } from '../../shared/contracts.ts';

// Hydration and passive reads work while the replacement is frozen. Launch/auth/edits do not.
const reads = new Set<string>([
  c.getTheme,
  c.getInfo,
  c.loadStudio,
  c.getStartup,
  c.readProject,
  c.listProjectActivity,
  c.listProjectUsage,
  c.readOutput,
  c.inspectVideoProject,
  c.readSkill,
  c.listTeamMessages,
  c.listTeamImports,
  c.readImageConnection,
  c.readMcpSecretStatus,
  c.getProviderStatus,
  c.getConnectionStatus,
  c.getModelCatalog,
  c.readAuthLogin,
  c.getComputerState,
]);
export class StartupAdmission {
  private held = false;
  hold() {
    this.held = true;
    return () => {
      this.held = false;
    };
  }
  assertAllowed(channel: string) {
    if (this.held && !reads.has(channel))
      throw new Error('Studio проверяет обновление. Дождитесь завершения запуска.');
  }
}
