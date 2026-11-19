import { t } from '../../shared/i18n/index.ts';
import { desktopChannels as c } from '../../shared/contracts.ts';

// Hydration and passive reads work while the replacement is frozen. Launch/auth/edits do not.
const reads = new Set<string>([
  c.getTheme,
  c.getLanguage,
  c.getGitHubStar,
  c.getInfo,
  c.getChat,
  c.loadChatDrafts,
  c.prepareAgentRefresh,
  c.listPiProcesses,
  c.loadStudio,
  c.getStartup,
  c.readProject,
  c.listProjectActivity,
  c.listProjectUsage,
  c.readOutput,
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
  c.getBrowserState,
  c.getOnboardingReadiness,
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
      throw new Error(t('StartupAdmission.studioIsVerifyingTheUpdateWaitFor'));
  }
}

/** Existing ledgers are already durable. History backfill is optional work, not startup health. */
export function holdStartup(
  admission: StartupAdmission,
  accounting: { hold(): { release(): void } },
) {
  const unlock = admission.hold();
  try {
    const paused = accounting.hold();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      paused.release();
      unlock();
    };
  } catch (error) {
    unlock();
    throw error;
  }
}
