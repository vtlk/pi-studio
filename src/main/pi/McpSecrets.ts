import { t } from '../../shared/i18n/index.ts';
import type { StudioService, StudioStore } from '../storage/StudioStore.ts';
import type { SecretVault } from '../storage/SecretVault.ts';
import type { Resource } from '../../shared/resources.ts';
import type { McpSecretEdit, McpSecretRequest, McpSecretStatus } from '../../shared/mcpSecrets.ts';
import { stableId } from '../storage/validation.ts';
import { nativeMcpConfig } from './nativeMcp.ts';
import {
  mcpConfigRevision,
  mcpSecretFields,
  piConfigValues,
  type PiConfigValues,
  withMcpSecrets,
} from './mcpSecretValues.ts';

const managed = 'keychain:pistudio-mcp';
interface SavedValues {
  revision: string;
  values: Record<string, string>;
}
export class McpSecrets {
  private service: StudioService;
  private vault: SecretVault;
  private piPath: () => string;
  private configValues: (path: string) => Promise<PiConfigValues>;
  constructor(
    service: StudioService,
    vault: SecretVault,
    piPath: () => string,
    configValues: (path: string) => Promise<PiConfigValues> = piConfigValues,
  ) {
    this.service = service;
    this.vault = vault;
    this.piPath = piPath;
    this.configValues = configValues;
  }
  private async scope(store: StudioStore, request: McpSecretRequest) {
    if (!request || request.folder !== store.folder)
      throw new Error(t('error.mcpSecrets.theStudioFolderChangedReopen'));
    const id = stableId(request.resourceId);
    const sections = store.bootstrap().sections;
    const resource = (sections.resources as Resource[]).find(
      (item) => item.id === id && item.kind === 'mcps',
    );
    if (!resource?.source.startsWith('pi:'))
      throw new Error(t('error.mcpSecrets.configureMcpThroughTheAssistant'));
    const config = await nativeMcpConfig(resource.source.slice(3));
    const parser = await this.configValues(String(sections.piPath ?? '') || this.piPath());
    return {
      resource,
      config,
      fields: mcpSecretFields(config, parser),
      revision: mcpConfigRevision(config),
      folder: store.folder,
    };
  }
  private async read(folder: string, id: string): Promise<SavedValues> {
    try {
      const saved = JSON.parse(await this.vault.read(folder, id)) as SavedValues;
      if (
        !saved ||
        typeof saved.revision !== 'string' ||
        !saved.values ||
        typeof saved.values !== 'object' ||
        Array.isArray(saved.values) ||
        Object.entries(saved.values).some(
          ([key, value]) =>
            !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
            typeof value !== 'string' ||
            !value ||
            /[\r\n\0]/.test(value),
        )
      )
        throw new Error();
      return saved;
    } catch {
      throw new Error(t('error.mcpSecrets.couldNotReadMcpParameters'));
    }
  }
  private async describe(
    scope: Awaited<ReturnType<McpSecrets['scope']>>,
  ): Promise<McpSecretStatus> {
    let saved: SavedValues | undefined,
      unreadable = false;
    let stored: boolean;
    try {
      stored = (await this.vault.inspect(scope.folder, scope.resource.id)).stored;
      if (stored) saved = await this.read(scope.folder, scope.resource.id);
    } catch {
      stored = true;
      unreadable = true;
    }
    const changed = !!saved && saved.revision !== scope.revision;
    let destination = 'Локальный stdio-сервер';
    if (typeof scope.config.url === 'string') {
      try {
        destination = new URL(scope.config.url).origin;
      } catch {
        destination = 'Некорректный URL MCP';
      }
    }
    return {
      revision: scope.revision,
      destination,
      secureStorageAvailable: await this.vault.available(),
      managed: scope.resource.credential === managed,
      hasSavedValues: stored,
      configurationChanged: changed,
      unreadable,
      fields: scope.fields.map((name) => ({
        name,
        stored: !!saved && Object.hasOwn(saved.values, name) && !changed,
      })),
    };
  }
  status(request: McpSecretRequest) {
    return this.service.serialize(async () =>
      this.describe(await this.scope(await this.service.load(), request)),
    );
  }
  private assertRevision(request: McpSecretEdit, revision: string) {
    if (request.revision !== revision)
      throw new Error(t('error.mcpSecrets.mcpConfigurationChangedReopenThe'));
  }
  async save(request: McpSecretEdit & { values: Record<string, string> }) {
    return this.service.serialize(async () => {
      const store = await this.service.load(),
        scope = await this.scope(store, request);
      this.assertRevision(request, scope.revision);
      if (
        !request.values ||
        typeof request.values !== 'object' ||
        Array.isArray(request.values) ||
        !Object.keys(request.values).length
      )
        throw new Error(t('error.mcpSecrets.enterAtLeastOneMcp'));
      for (const [name, value] of Object.entries(request.values))
        if (
          !scope.fields.includes(name) ||
          typeof value !== 'string' ||
          !value.trim() ||
          value.length > 8192 ||
          /[\r\n\0]/.test(value)
        )
          throw new Error(t('error.mcpSecrets.mcpParameterValuesMustNot'));
      let previous: SavedValues | undefined;
      try {
        previous = await this.read(scope.folder, scope.resource.id);
      } catch {
        /* Explicit entry replaces unreadable credentials. */
      }
      const values = {
        ...(previous?.revision === scope.revision ? previous.values : {}),
        ...request.values,
      };
      const names =
        scope.resource.mcpSecretNames ??
        (previous
          ? Object.keys(previous.values)
          : scope.resource.credential === managed
            ? scope.fields
            : []);
      if (names.some((name) => scope.fields.includes(name) && !Object.hasOwn(values, name)))
        throw new Error(t('error.mcpSecrets.reEnterAllPreviouslySaved'));
      const ownedNames = [...new Set([...names, ...Object.keys(values)])];
      if (ownedNames.length > 64)
        throw new Error(t('error.mcpSecrets.tooManyProtectedParametersFor'));
      const encoded = JSON.stringify({ revision: scope.revision, values });
      if (encoded.length > 16000)
        throw new Error(t('error.mcpSecrets.protectedMcpParametersAreToo'));
      if (
        mcpConfigRevision(await nativeMcpConfig(scope.resource.source.slice(3))) !== scope.revision
      )
        throw new Error(t('error.mcpSecrets.mcpConfigurationChangedEnterValues'));
      await this.vault.save(scope.folder, scope.resource.id, encoded);
      const resource = {
        ...scope.resource,
        credential: managed,
        mcpSecretNames: ownedNames,
        check: undefined,
      };
      await store.saveSection(
        'resources',
        (store.bootstrap().sections.resources as Resource[]).map((item) =>
          item.id === resource.id ? resource : item,
        ),
      );
      return this.describe({ ...scope, resource });
    });
  }
  remove(request: McpSecretEdit) {
    return this.service.serialize(async () => {
      const store = await this.service.load(),
        scope = await this.scope(store, request);
      this.assertRevision(request, scope.revision);
      let names = scope.resource.mcpSecretNames;
      if (!names && scope.resource.credential === managed) {
        try {
          names = Object.keys((await this.read(scope.folder, scope.resource.id)).values);
        } catch {
          names = scope.fields;
        }
      }
      await this.vault.remove(scope.folder, scope.resource.id);
      const resource = {
        ...scope.resource,
        ...(names ? { mcpSecretNames: names } : {}),
        check: undefined,
      };
      await store.saveSection(
        'resources',
        (store.bootstrap().sections.resources as Resource[]).map((item) =>
          item.id === scope.resource.id ? resource : item,
        ),
      );
      return this.describe({ ...scope, resource });
    });
  }
  async revision(folder: string, resource: Resource) {
    if (resource.kind !== 'mcps' || !resource.source.startsWith('pi:')) return '';
    return `${mcpConfigRevision(await nativeMcpConfig(resource.source.slice(3)))}:${(await this.vault.inspect(folder, resource.id)).revision}`;
  }
  resolver(folder: string, piPath: string) {
    return async (resource: Resource, config: Record<string, unknown>) => {
      if (resource.credential !== managed) return config;
      const parser = await this.configValues(piPath),
        fields = mcpSecretFields(config, parser);
      if (!fields.length) return config;
      const saved = await this.read(folder, resource.id);
      if (saved.revision !== mcpConfigRevision(config))
        throw new Error(t('error.mcpSecrets.mcpChangedExplicitlySaveParameters'));
      const names = resource.mcpSecretNames ?? Object.keys(saved.values);
      if (names.some((name) => fields.includes(name) && !Object.hasOwn(saved.values, name)))
        throw new Error(t('error.mcpSecrets.saveProtectedMcpParametersIn'));
      if (saved.revision !== mcpConfigRevision(await nativeMcpConfig(resource.source.slice(3))))
        throw new Error(t('error.mcpSecrets.mcpConfigurationChangedWhileOpening'));
      return withMcpSecrets(config, saved.values, parser);
    };
  }
}
