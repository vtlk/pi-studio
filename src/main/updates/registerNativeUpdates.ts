import { t } from '../../shared/i18n/index.ts';
import { app, powerMonitor } from 'electron';
import { dirname, join } from 'node:path';
import { mkdirSync, realpathSync } from 'node:fs';
import packageInfo from '../../../package.json';
import publicKey from './publicKey.json';
import { NativeUpdateInstaller } from './NativeUpdateInstaller.ts';
import { UpdateCoordinator } from './UpdateCoordinator.ts';
import { normalizeOsVersion } from './releasePolicy.ts';
import { NativeUpdates } from './NativeUpdates.ts';
import { registerUpdateHandlers } from './registerUpdateHandlers.ts';
import { updateHelperNode } from './updateRuntime.ts';
import { acquireInstallation } from './InstallationAdmission.ts';
import { saveUpdateView } from './UpdateViewStore.ts';
import { desktopInvocationGate, desktopStartupAdmission } from '../ipc/desktopInvoke.ts';
import { managedPiPath, piNode } from '../pi/platform.ts';
import type { StudioService } from '../storage/StudioStore.ts';
import type { Startup } from '../pi/Startup.ts';
import type { BrowserAuth } from '../pi/BrowserAuth.ts';
import type { BrowserSupport } from '../browser/BrowserSupport.ts';
import type { ImageGeneration } from '../images/ImageGeneration.ts';
import type { TeamSupport } from '../team-mcp/TeamSupport.ts';
import type { UsageRecovery } from '../accounting/UsageRecovery.ts';
import type { RunUpdateGuard } from '../pi/RunUpdateGuard.ts';
import type { IpcMainInvokeEvent } from 'electron';
import type { UpdateStartup } from './UpdateStartup.ts';

export function applicationRoot(executable: string, platform = process.platform) {
  return platform === 'darwin' ? dirname(dirname(dirname(executable))) : dirname(executable);
}
interface Options {
  service: StudioService;
  startup: Startup;
  boot?: UpdateStartup;
  runs: RunUpdateGuard[];
  images: ImageGeneration;
  team: TeamSupport;
  auth: BrowserAuth;
  browser: BrowserSupport;
  accounting: UsageRecovery;
  caller(event: IpcMainInvokeEvent): unknown;
}
export function registerNativeUpdates(o: Options) {
  const target = realpathSync(applicationRoot(process.execPath));
  const userData = app.getPath('userData');
  mkdirSync(userData, { recursive: true, mode: 0o700 });
  const canonicalData = realpathSync(userData);
  const assertIdle = () => {
    for (const run of o.runs) run.assertIdle();
    o.images.assertIdle();
    o.team.assertUpdateIdle();
    o.auth.assertUpdateIdle();
    o.startup.assertUpdateIdle();
    o.browser.assertUpdateIdle();
  };
  const releaseStartup =
    o.boot?.read().phase === 'starting' ? desktopStartupAdmission.hold() : () => {};
  const enabled =
    app.isPackaged &&
    ['darwin', 'win32'].includes(process.platform) &&
    ['arm64', 'x64'].includes(process.arch);
  const coordinator: UpdateCoordinator | undefined = enabled
    ? new UpdateCoordinator({
        target: {
          version: packageInfo.version,
          platform: process.platform as 'darwin' | 'win32',
          arch: process.arch,
          osVersion: normalizeOsVersion(process.getSystemVersion()),
        },
        publicKey: publicKey.spki,
        cacheRoot: join(canonicalData, 'updates/downloads'),
        installer: new NativeUpdateInstaller({
          target,
          userData: canonicalData,
          version: packageInfo.version,
          platform: process.platform as 'darwin' | 'win32',
          arch: process.arch as 'arm64' | 'x64',
          helperSource: join(__dirname, '../../bundled/update-helper'),
          protectedRoots: () => o.service.serialize(async () => [(await o.service.load()).folder]),
          helperNode: async (signal) => {
            let candidate: string | undefined;
            try {
              candidate = await piNode(
                o.startup.path || managedPiPath(join(canonicalData, 'runtime/pi')),
              );
            } catch {
              /* A standalone update runtime is supported. */
            }
            return updateHelperNode(
              join(canonicalData, 'runtime/update-node'),
              target,
              candidate,
              signal,
            );
          },
        }),
        idle: () => {
          try {
            assertIdle();
            return true;
          } catch {
            return false;
          }
        },
        acquire: () =>
          acquireInstallation({
            assertIdle,
            gate: () => desktopInvocationGate.acquire(),
            runs: o.runs,
            background: o.accounting,
          }),
        flushMain: async (view) => {
          await o.accounting.flush();
          await o.service.serialize(async () => {
            const store = await o.service.load();
            const next = coordinator!.read().offer?.version;
            if (!next) throw new Error(t('error.registerNativeUpdates.updateVersionNotDetermined'));
            const valid =
              view?.page === 'project' &&
              !store.projects.list().some((p) => p.id === view.projectId)
                ? { page: 'projects' as const }
                : view;
            await saveUpdateView(canonicalData, packageInfo.version, next, store.folder, valid);
          });
        },
        quit: () => app.quit(),
      })
    : undefined;
  const updates = new NativeUpdates({
    version: packageInfo.version,
    userData: canonicalData,
    target,
    coordinator,
    startup: o.boot,
    folder: () => o.service.serialize(async () => (await o.service.load()).folder),
    flush: async () => {
      await o.accounting.flush();
      await o.service.serialize(async () => {
        await o.service.load();
      });
    },
    releaseStartup,
    quit: () => app.quit(),
  });
  registerUpdateHandlers(updates, o.caller);
  const wake = () => updates.wake();
  powerMonitor.on('resume', wake);
  app.once('quit', () => powerMonitor.removeListener('resume', wake));
  return updates;
}
