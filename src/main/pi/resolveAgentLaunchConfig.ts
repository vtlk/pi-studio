import { t } from '../../shared/i18n/index.ts';
import { resolveReasoning } from '../../shared/reasoning.ts';
import { dirname, join } from 'node:path';
import type { Agent } from '../../shared/studio.ts';
import type { Connection } from '../../shared/connections.ts';
import { validateAgentModel } from '../../shared/modelConfiguration.ts';
import { connectionAuthScope, getModelProviderStatus } from './modelAuth.ts';
import { readPiCatalog } from './catalog.ts';

interface Options {
  folder: string;
  piPath: string;
  bootstraps: string;
  catalog: string;
}

/** Resolve one explicit account/model before any project, job or session is created. */
export async function resolveAgentLaunchConfig(
  selection: Agent['model'],
  connections: readonly Connection[],
  options: Options,
) {
  const validated = validateAgentModel(selection, connections);
  if (!validated.ok) {
    if (validated.reason === 'missing-model')
      throw new Error(t('error.contextBuilder.selectTheAgentSConnection'));
    throw new Error(t('error.resolveAgentLaunchConfig.theAgentSConnectionIs'));
  }
  const { model, connection } = validated;
  const { piPath, folder, catalog, bootstraps } = options;
  const modelAuth = await connectionAuthScope(
    join(dirname(bootstraps), 'model-auth'),
    folder,
    connection,
  );
  const status = await getModelProviderStatus(
    piPath,
    join(dirname(catalog), 'model-auth.mjs'),
    connection.providerId,
    modelAuth,
    folder,
  );
  if (status.status !== 'ready')
    throw new Error(status.detail ?? t('error.resolveAgentLaunchConfig.signInToTheSelected'));
  const models = await readPiCatalog(piPath, catalog, folder, modelAuth);
  const selectedModel = models.models.find(
    (item) => item.provider === model.provider && item.id === model.id,
  );
  if (!selectedModel)
    throw new Error(t('error.resolveAgentLaunchConfig.theSelectedModelIsMissing'));
  const thinkingLevel = resolveReasoning(model.reasoning, selectedModel);
  return { model, selectedModel, modelAuth, thinkingLevel };
}
