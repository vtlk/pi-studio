import type { Resource } from '../../shared/resources.ts';
import type { PortableResource } from '../../shared/teamPackage.ts';
import { t } from '../../shared/i18n/index.ts';
import type { StudioService, StudioStore } from '../storage/StudioStore.ts';
import { listImports, readImport } from './importState.ts';
import { isLocalMcpPath } from './portableMcp.ts';
import { findNativeMcpConfig, nativeMcpConfig } from '../pi/nativeMcp.ts';

export function importedMcpName(id: string) {
  return `studio_import_${id.replaceAll('-', '_')}`;
}

export function importedMcpConfig(resource: Resource, portable: PortableResource) {
  const name = importedMcpName(resource.id);
  const config = portable.mcp;
  if (resource.source !== `pi:${name}` || portable.kind !== 'mcps' || !config)
    throw new Error(t('error.teamImportTools.theResourceChangedConfigureIt'));
  const values = [config.command, ...(Array.isArray(config.args) ? config.args : [])];
  if (values.some((value) => typeof value === 'string' && isLocalMcpPath(value)))
    throw new Error(t('error.teamImportTools.explicitlyMapThePackageS'));
  return { name, config };
}

export async function loadMcpForLogin(
  service: StudioService,
  folder: string,
  resource: Resource,
  configure: (args: Record<string, unknown>) => Promise<unknown>,
) {
  const name = resource.source.slice(3);
  const existing = await findNativeMcpConfig(name);
  if (existing) return existing;
  const imported =
    name === importedMcpName(resource.id) &&
    (await service.serialize(async () => {
      const store = await service.load();
      if (store.folder !== folder)
        throw new Error(t('error.studioResources.theStudioFolderChangedReopen'));
      return findImportedMcp(store, resource.id);
    }));
  if (imported) await configure(imported);
  return nativeMcpConfig(name);
}

async function findImportedMcp(store: StudioStore, id: string) {
  const resource = (store.bootstrap().sections.resources as Resource[]).find(
    (item) => item.id === id && item.source === `pi:${importedMcpName(id)}`,
  );
  if (!resource) return;
  const report = (await listImports(store)).find((item) =>
    item.mcps?.some((mcp) => mcp.resourceId === id),
  );
  if (!report) return;
  const { state, data } = await readImport(store, report.id);
  const portable = data.manifest.resources.find((item) => state.resourceMap[item.id] === id);
  if (!portable) return;
  const entry = importedMcpConfig(resource, portable);
  // OAuth must not implicitly execute a sender-provided credential command.
  if (Object.values(entry.config).some(hasCommandReference))
    throw new Error(t('TeamTransfers.reviewMcpCredentialCommand'));
  return { ...entry, displayName: resource.name };
}

function hasCommandReference(value: unknown): boolean {
  if (typeof value === 'string') return value.startsWith('!');
  return !!value && typeof value === 'object' && Object.values(value).some(hasCommandReference);
}
