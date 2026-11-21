import type { StudioService } from '../storage/StudioStore.ts';
import type { PreparedRun } from './ContextBuilder.ts';
import type { StudioResources } from './StudioResources.ts';
import { assertAdministrationScope } from './administrationScope.ts';
import {
  catalogConnection,
  catalogPage,
  compactCatalogRows,
  compactModelRows,
  compactNativeMcpRows,
  type ReadModelCatalog,
} from './catalogReads.ts';
import { t } from '../../shared/i18n/index.ts';

export async function readAdminCatalog(
  service: StudioService,
  run: PreparedRun,
  name: string,
  args: Record<string, unknown>,
  modelCatalog: ReadModelCatalog,
  native?: StudioResources,
) {
  const target = await service.serialize(async () => {
    const store = await service.load();
    await assertAdministrationScope(store, run);
    if (name === 'list_models')
      return { store, connection: catalogConnection(store, args.connection_id) };
    if (name === 'list_native_mcps') return { store };
    return { store, rows: compactCatalogRows(store, name, args) };
  });
  if (target.rows) return catalogPage(name, target.rows, args);
  const connection = target.connection;
  const rows = connection
    ? compactModelRows(await modelCatalog(connection, target.store.folder), connection, args)
    : compactNativeMcpRows((await native?.listNative(target.store.folder))?.servers ?? [], args);
  return service.serialize(async () => {
    const store = await service.load();
    await assertAdministrationScope(store, run);
    if (
      store !== target.store ||
      (connection &&
        JSON.stringify(catalogConnection(store, connection.id)) !== JSON.stringify(connection))
    )
      throw Error(t('SettingsRead.changed'));
    return catalogPage(name, rows, args);
  });
}
