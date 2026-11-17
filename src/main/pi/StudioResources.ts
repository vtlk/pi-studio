import { t } from '../../shared/i18n/index.ts';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { piEnvironment, piNode } from './platform.ts';
import { realpath } from 'node:fs/promises';
import { missingMcpExecutable } from '../onboarding/mcpExecutable.ts';
import type { StudioService } from '../storage/StudioStore.ts';
import type { Resource, ResourceCheck } from '../../shared/resources.ts';
import { inspectSkill } from '../storage/skills.ts';
import {
  nativeResourceOperation,
  type NativeResourceRequest,
  type NativeResourceResult,
} from './NativeResources.ts';
import { assertCredentialReferences, packageSource } from './resourceConfig.ts';
import type { McpSecrets } from './McpSecrets.ts';
import { nativeMcpConfig } from './nativeMcp.ts';
import { mcpConfigRevision } from './mcpSecretValues.ts';
import type { BrowserAuth } from './BrowserAuth.ts';
import type { BrowserSupport } from '../browser/BrowserSupport.ts';
import { browserMcp, computerMcp, reservedMcpName } from '../../shared/builtinResources.ts';
import type { ComputerSupport } from '../computer/ComputerSupport.ts';

interface Options {
  script: string;
  browserAuth?: BrowserAuth;
  piPath: () => string;
  operation?: typeof nativeResourceOperation;
  mcpSecrets?: McpSecrets;
  browser?: BrowserSupport;
  computer?: ComputerSupport;
}
const signature = (resource: Resource) =>
  JSON.stringify([
    resource.kind,
    resource.source,
    resource.args,
    resource.credential,
    resource.mcpSecretNames,
  ]);
export class StudioResources {
  private readonly service: StudioService;
  private readonly options: Options;
  constructor(service: StudioService, options: Options) {
    this.service = service;
    this.options = options;
  }
  private async scope(expected?: string) {
    return this.service.serialize(async () => {
      const store = await this.service.load();
      if (expected && store.folder !== expected)
        throw new Error(t('error.studioResources.theStudioFolderChangedReopen'));
      return {
        folder: store.folder,
        piPath: String(store.bootstrap().sections.piPath ?? '') || this.options.piPath(),
        resources: (store.bootstrap().sections.resources ?? []) as Resource[],
      };
    });
  }
  private call(path: string, request: NativeResourceRequest) {
    return (this.options.operation ?? nativeResourceOperation)(path, this.options.script, request);
  }
  /** No process execution or secret decryption. Revisions invalidate previously successful checks. */
  async onboardingProbe(id: string, folder: string) {
    const scope = await this.scope(folder);
    const resource = scope.resources.find((item) => item.id === id && item.kind === 'mcps');
    if (!resource) return { revision: 'missing-resource', missing: true };
    let revision = signature(resource);
    if (!resource.source.startsWith('pi:')) return { revision, missing: false };
    try {
      const config = await nativeMcpConfig(resource.source.slice(3));
      revision += ':' + mcpConfigRevision(config);
      try {
        revision += ':' + ((await this.options.mcpSecrets?.revision(folder, resource)) ?? '');
      } catch {
        revision += ':unreadable-credentials';
      }
      const nodeDirectory =
        typeof config.command === 'string'
          ? dirname(await realpath(await piNode(scope.piPath)))
          : dirname(scope.piPath);
      if (await missingMcpExecutable(config, piEnvironment(nodeDirectory).PATH))
        return { revision, missing: true };
      return { revision, missing: false };
    } catch {
      return { revision: revision + ':missing-config', missing: true };
    }
  }
  async listNative(folder: string) {
    const scope = await this.scope(folder);
    return this.call(scope.piPath, { action: 'list-mcp', cwd: folder });
  }
  async runtimeInfo(folder: string) {
    const scope = await this.scope(folder);
    return this.call(scope.piPath, { action: 'inspect-runtime', cwd: folder });
  }
  private async publish(folder: string, resource: Resource, replaceName = false) {
    return this.service.serialize(async () => {
      const store = await this.service.load();
      if (store.folder !== folder)
        throw new Error(t('error.studioResources.theStudioChangedTheResource'));
      const current = (store.bootstrap().sections.resources ?? []) as Resource[];
      const old = current.find(
        (item) => item.kind === resource.kind && item.source === resource.source,
      );
      const saved = {
        ...resource,
        credential:
          old?.credential === 'keychain:pistudio-mcp' ? old.credential : resource.credential,
        ...(old?.mcpSecretNames ? { mcpSecretNames: old.mcpSecretNames } : {}),
        name: old && !replaceName ? old.name : resource.name,
        description: resource.description || old?.description || '',
        version: resource.version || old?.version || '',
        ...(old ? { id: old.id, createdAt: old.createdAt } : {}),
      };
      await store.saveSection('resources', [
        saved,
        ...current.filter((item) => item.id !== saved.id),
      ]);
      return saved;
    });
  }
  async configureMcp(folder: string, args: Record<string, unknown>) {
    if (
      typeof args.name !== 'string' ||
      !/^[a-zA-Z0-9_-]+$/.test(args.name) ||
      reservedMcpName(args.name)
    )
      throw new Error(t('error.studioResources.specifyANativeMcpName'));
    if (!args.config || typeof args.config !== 'object' || Array.isArray(args.config))
      throw new Error(t('error.studioResources.serverConfigurationInNativePi'));
    const config = args.config as Record<string, unknown>;
    assertCredentialReferences(config);
    const scope = await this.scope(folder);
    const result = await this.call(scope.piPath, {
      action: 'configure-mcp',
      cwd: folder,
      name: args.name,
      config,
      replace: args.replace === true,
    });
    return this.importMcp(
      folder,
      args.name,
      typeof args.displayName === 'string' ? args.displayName : undefined,
      result,
    );
  }
  async importMcp(
    folder: string,
    name: string,
    displayName?: string,
    metadata?: NativeResourceResult,
  ) {
    if (!/^[a-zA-Z0-9_-]+$/.test(name) || reservedMcpName(name))
      throw new Error(t('error.studioResources.invalidNativeMcpName'));
    if (!metadata) {
      const listed = await this.listNative(folder);
      metadata = listed.servers?.find((server) => server.name === name);
    }
    if (!metadata) throw new Error(t('error.studioResources.noSuchServerFoundIn'));
    const source = `pi:${name}`;
    return this.publish(
      folder,
      {
        id: createHash('sha256').update(`mcp:${name}`).digest('hex').slice(0, 32),
        name: displayName?.trim() || name,
        kind: 'mcps',
        source,
        description: metadata.description ?? '',
        transport: metadata.transport ?? '',
        version: '',
        args: '',
        credential: '',
        contents: '',
        createdAt: Date.now(),
      },
      !!displayName?.trim(),
    );
  }
  async installPackage(folder: string, sourceValue: unknown, displayName?: string) {
    const source = packageSource(sourceValue);
    const scope = await this.scope(folder);
    const result = await this.call(scope.piPath, {
      action: 'install-package',
      cwd: folder,
      source,
    });
    return this.publish(
      folder,
      {
        id: createHash('sha256').update(`package:${source}`).digest('hex').slice(0, 32),
        name: displayName?.trim() || source,
        kind: 'plugins',
        source,
        version: result.version ?? '',
        description: '',
        transport: '',
        args: '',
        credential: '',
        contents: result.contents ?? '',
        createdAt: Date.now(),
        check: { status: result.status ?? 'unavailable', checkedAt: Date.now() },
      },
      !!displayName?.trim(),
    );
  }
  async check(id: string, expectedFolder?: string): Promise<ResourceCheck> {
    const scope = await this.scope(expectedFolder);
    if (id === browserMcp.id && this.options.browser) return this.options.browser.check();
    if (id === computerMcp.id && this.options.computer) return this.options.computer.check();
    const resource = scope.resources.find((item) => item.id === id);
    if (!resource) throw new Error(t('error.studioResources.resourceMissingFromTheCurrent'));
    if (resource.credential === 'keychain:pistudio-mcp' && !this.options.mcpSecrets)
      throw new Error(t('error.studioResources.protectedMcpParametersUnavailable'));
    const secretRevision = await this.options.mcpSecrets?.revision(scope.folder, resource);
    let result: NativeResourceResult;
    if (resource.kind === 'skills') {
      await inspectSkill(resource.source);
      result = { status: 'available' };
    } else if (resource.kind === 'plugins')
      result = await this.call(scope.piPath, {
        action: 'check-package',
        cwd: scope.folder,
        source: packageSource(resource.source),
      });
    else if (resource.source.startsWith('pi:')) {
      const config = this.options.mcpSecrets
        ? await nativeMcpConfig(resource.source.slice(3))
        : undefined;
      result = await this.call(scope.piPath, {
        action: 'check-mcp',
        cwd: scope.folder,
        name: resource.source.slice(3),
        ...(config && this.options.mcpSecrets
          ? {
              config:
                config.enabled === false
                  ? config
                  : await this.options.mcpSecrets.resolver(scope.folder, scope.piPath)(
                      resource,
                      config,
                    ),
            }
          : {}),
      });
    } else {
      if (resource.credential)
        throw new Error(t('error.studioResources.forAuthenticationUseNativePi'));
      const config = /^https?:\/\//.test(resource.source)
        ? { url: resource.source }
        : { command: resource.source, args: JSON.parse(resource.args || '[]') as unknown };
      assertCredentialReferences(config);
      result = await this.call(scope.piPath, {
        action: 'check-mcp',
        cwd: scope.folder,
        name: `studio_${resource.id.replace(/[^a-zA-Z0-9_]/g, '_')}`,
        config,
      });
    }
    const check: ResourceCheck = {
      status: result.status ?? 'unavailable',
      checkedAt: Date.now(),
      ...(result.toolCount === undefined ? {} : { toolCount: result.toolCount }),
    };
    await this.service.serialize(async () => {
      const store = await this.service.load();
      const current = (store.bootstrap().sections.resources ?? []) as Resource[];
      const selected = current.find((item) => item.id === id);
      if (store.folder !== scope.folder || !selected || signature(selected) !== signature(resource))
        throw new Error(t('error.studioResources.resourceSettingsChangedDuringVerific'));
      if (secretRevision !== (await this.options.mcpSecrets?.revision(scope.folder, selected)))
        throw new Error(t('error.studioResources.mcpKeysOrConfigurationChanged'));
      await store.saveSection(
        'resources',
        current.map((item) => (item.id === id ? { ...item, check } : item)),
      );
    });
    return check;
  }
  async install(id: string) {
    const scope = await this.scope();
    if (id === browserMcp.id && this.options.browser) return this.options.browser.install();
    const resource = scope.resources.find((item) => item.id === id && item.kind === 'plugins');
    if (!resource) throw new Error(t('error.studioResources.packageMissing'));
    return this.installPackage(scope.folder, resource.source, resource.name);
  }
  async login(id: string, expectedFolder?: string) {
    const scope = await this.scope(expectedFolder);
    const resource = scope.resources.find((item) => item.id === id && item.kind === 'mcps');
    if (!resource?.source.startsWith('pi:'))
      throw new Error(t('error.studioResources.configureTheServerThroughThe'));
    const name = resource.source.slice(3);
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error(t('error.studioResources.invalidMcpName'));
    const raw = await nativeMcpConfig(name);
    if (raw.enabled === false) throw new Error(t('ResourceActions.serverDisabledInPi'));
    if (raw.auth && typeof raw.auth === 'object' && 'provider' in raw.auth)
      return {
        opened: false,
        authorized: false,
        next: 'Этот MCP использует авторизацию провайдера Pi. Настройте его в «Подключениях», затем проверьте MCP.',
      };
    const headers = raw.headers && typeof raw.headers === 'object' ? Object.keys(raw.headers) : [];
    if (!raw.url || headers.some((key) => key.toLowerCase() === 'authorization'))
      return {
        opened: false,
        authorized: false,
        next: 'Откройте «Настройки → MCP-серверы → Защищённые параметры», сохраните необходимые значения и проверьте подключение. Ключи не передаются в чат или Terminal.',
      };
    if (!this.options.browserAuth)
      throw new Error(t('error.studioResources.mcpBrowserSignInUnavailable'));
    const config = this.options.mcpSecrets
      ? await this.options.mcpSecrets.resolver(scope.folder, scope.piPath)(resource, raw)
      : raw;
    const revision = await this.options.mcpSecrets?.revision(scope.folder, resource);
    const unchanged = async () => {
      const current = await this.scope(scope.folder);
      const selected = current.resources.find((item) => item.id === id);
      return (
        !!selected &&
        signature(selected) === signature(resource) &&
        mcpConfigRevision(await nativeMcpConfig(name)) === mcpConfigRevision(raw) &&
        revision === (await this.options.mcpSecrets?.revision(scope.folder, selected))
      );
    };
    const state = await this.options.browserAuth.startMcp(
      scope.piPath,
      `${scope.folder}\0${id}`,
      { name, config },
      async () => {
        if (!(await unchanged()))
          throw new Error(t('error.studioResources.mcpSettingsChangedDuringSign'));
        const check = await this.check(id);
        return (await unchanged()) && check.status === 'available';
      },
    );
    return {
      opened: true,
      authorized: false,
      loginId: state.id,
      next: 'Завершите вход в браузере. Pi сохранит OAuth; Studio проверит фактическую доступность MCP.',
    };
  }
}
