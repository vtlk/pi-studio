import { join } from 'node:path';
import { t } from '../../shared/i18n/index.ts';
import { hasBuiltinMcp } from '../../shared/builtinAssignments.ts';
import type { StudioStore } from '../storage/StudioStore.ts';
import type { PreparedRun } from './ContextBuilder.ts';

/** Administrative access is pinned for the helper and explicit for an exact project agent. */
export async function assertAdministrationScope(store: StudioStore, run: PreparedRun) {
  if (isSetupAssistantRun(store, run)) return;
  const id = run.agent?.profile?.id;
  const current = store.agentCatalog().agents.find((agent) => agent.id === id);
  const project = store.projects.list().find((project) => project.id === run.project?.id);
  if (
    current &&
    hasBuiltinMcp(current, 'pistudio-administration') &&
    project?.agents.some((agent) => agent.profile.id === id) &&
    (await store.projects.directory(project.id)) === run.projectRoot
  )
    return;
  throw new Error(t('builtin.assignmentDisabled'));
}

export function isSetupAssistantRun(store: StudioStore, run: PreparedRun) {
  return run.projectRoot === join(store.folder, '.pistudio/setup-assistant');
}
