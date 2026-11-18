import { t } from '../../shared/i18n/index.ts';
import { resolveReasoning } from '../../shared/reasoning.ts';
import { dirname, join } from 'node:path';
import type { Agent } from '../../shared/studio.ts';
import type { Connection } from '../../shared/connections.ts';
import { validateAgentModel } from '../../shared/modelConfiguration.ts';
import { connectionAuthScope, modelAuthOperation } from './modelAuth.ts';
import { checkPi } from './checkPi.ts';
import type { ProviderStatus } from '../../shared/contracts.ts';
import type { PiModelCatalog } from '../../shared/models.ts';

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
  const piCheck = await checkPi(piPath);
  const { status, catalog: models } = await modelAuthOperation<{
    status: ProviderStatus;
    catalog?: PiModelCatalog;
  }>(
    piPath,
    join(dirname(catalog), 'model-auth.mjs'),
    { action: 'launch', provider: connection.providerId, scope: modelAuth, cwd: folder },
    piCheck,
  );
  if (
    status?.provider !== connection.providerId ||
    !['ready', 'not_ready', 'invalid'].includes(status.status)
  )
    throw new Error(t('error.modelConnections.unsupportedPiAuthenticationResponse'));
  if (status.status !== 'ready')
    throw new Error(status.detail ?? t('error.resolveAgentLaunchConfig.signInToTheSelected'));
  if (!Array.isArray(models?.models) || !Array.isArray(models.providers))
    throw new Error(t('error.catalog.piReturnedAnIncompatibleModel'));
  const selectedModel = models.models.find(
    (item) => item.provider === model.provider && item.id === model.id,
  );
  if (!selectedModel)
    throw new Error(t('error.resolveAgentLaunchConfig.theSelectedModelIsMissing'));
  const thinkingLevel = resolveReasoning(model.reasoning, selectedModel);
  return { model, selectedModel, modelAuth, thinkingLevel, piCheck };
}
