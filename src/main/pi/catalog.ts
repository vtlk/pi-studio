import { t } from '../../shared/i18n/index.ts';
import { dirname, join } from 'node:path';
import { modelAuthOperation, type ModelAuthScope } from './modelAuth.ts';
import type { PiModelCatalog } from '../../shared/models.ts';

export async function readPiCatalog(
  path: string,
  script: string,
  cwd?: string,
  scope?: ModelAuthScope,
): Promise<PiModelCatalog> {
  const data = await modelAuthOperation<PiModelCatalog>(
    path,
    join(dirname(script), 'model-auth.mjs'),
    {
      action: 'catalog',
      scope,
      cwd,
    },
  );
  if (!Array.isArray(data.providers) || !Array.isArray(data.models))
    throw new Error(t('error.catalog.piReturnedAnIncompatibleModel'));
  return data;
}
