import { t } from '../../shared/i18n/index.ts';
import type { LiveRun } from './RunTypes.ts';

interface Host {
  assertIdle(): void;
  stopAgent(projectId: string, agentId: string): Promise<void>;
}
/** Closing idle dialogues is reversible: a failed update never leaves RunHost permanently stopped. */
export class RunUpdateGuard {
  private held = false;
  private readonly host: Host;
  private readonly live: ReadonlyMap<string, LiveRun>;
  private readonly chains: Map<string, symbol>;
  private readonly stopping: () => boolean;
  constructor(
    host: Host,
    live: ReadonlyMap<string, LiveRun>,
    chains: Map<string, symbol>,
    stopping: () => boolean,
  ) {
    this.host = host;
    this.live = live;
    this.chains = chains;
    this.stopping = stopping;
  }
  assertIdle() {
    this.host.assertIdle();
    if (
      [...this.live.values()].some(
        (live) =>
          // Only a validated, pending handoff is work. An armed but waiting/failed
          // dialogue has nothing to continue until a new explicit user request.
          live.status === 'ready' &&
          !live.blocked &&
          live.request.autoContinue &&
          live.sequence >= (live.continueAfterSequence ?? 1) &&
          live.chain &&
          this.chains.get(live.run.project.id) === live.chain,
      )
    )
      throw new Error(t('error.runUpdateGuard.waitForTheAgentChain'));
  }
  assertOpen() {
    if (this.held) throw new Error(t('error.runUpdateGuard.piStudioIsInstallingAn'));
  }
  hold() {
    this.assertIdle();
    if (this.held || this.stopping()) throw new Error(t('error.runUpdateGuard.piIsAlreadyClosing'));
    // No active chain survived the check; invalidate orphan permissions left by closed Pi.
    this.chains.clear();
    this.held = true;
    let released = false;
    const verify = () => {
      if (released || !this.held)
        throw new Error(t('error.runUpdateGuard.installationPermissionHasAlreadyEnde'));
      this.assertIdle();
    };
    return {
      verify,
      drainIdle: async () => {
        verify();
        for (const live of [...this.live.values()]) {
          verify();
          await this.host.stopAgent(live.run.project.id, live.run.agent.profile.id);
        }
      },
      release: () => {
        if (!released) {
          released = true;
          this.held = false;
        }
      },
    };
  }
}
