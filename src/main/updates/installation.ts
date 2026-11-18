import type { UpdateManifest } from '../../shared/updates.ts';

export interface PreparedInstallation {
  /** Start an exact-process helper, which still waits for commit and actual app exit. */
  arm(): Promise<void>;
  /** Durably allow replacement after normal exit. Never kills the application. */
  commit(): Promise<void>;
  /** Cancel an armed helper, discard only owned uncommitted staging. */
  dispose(): Promise<void>;
}
export interface UpdateInstaller {
  prepare(
    archive: string,
    manifest: UpdateManifest,
    signal: AbortSignal,
  ): Promise<PreparedInstallation>;
}
export interface InstallLease {
  /** Await already admitted native operations while new invocations are held. */
  ready?(signal: AbortSignal): Promise<void>;
  verify(): void;
  drainIdle(): Promise<void>;
  release(): void;
}
