import { join } from 'node:path';
import type { SessionBinding } from '../../shared/project.ts';
import { t } from '../../shared/i18n/index.ts';
import { atomicJson, isMissing, readJson, safePath } from '../storage/files.ts';
import { hasLiveSessionLease } from '../storage/sessionLease.ts';
import type { StudioService } from '../storage/StudioStore.ts';
import type { PreparedRun } from './ContextBuilder.ts';

/** Detach the current binding; keep native JSONL histories and all output files intact. */
export function resetStoredChat(service: StudioService, run: PreparedRun) {
  return service.serialize(async () => {
    const store = await service.load();
    const helper = run.project.id === 'pi-setup-assistant';
    const root = helper
      ? await safePath(store.folder, '.pistudio/setup-assistant')
      : await store.projects.directory(run.project.id);
    if (root !== run.projectRoot) throw Error(t('registerTeamHandlers.studioFolderChanged'));
    if (await hasLiveSessionLease(run.record.leaseDirectory ?? run.record.cwd))
      throw Error(t('error.deleteAgentData.theDialogueIsStillOpen'));
    const state = helper
      ? ((await readJson(await safePath(root, 'state.json', true)).catch((error) => {
          if (!isMissing(error)) throw error;
          return { schemaVersion: 1, outputPath: run.agent.outputPath };
        })) as {
          schemaVersion: number;
          session?: SessionBinding;
          outputPath?: string;
        })
      : undefined;
    if (state && state.schemaVersion !== 1)
      throw Error(t('error.createSetupAssistant.unsupportedAssistantHistoryVersion'));
    const agent = helper
      ? run.agent
      : store.projects
          .snapshot(run.project.id)
          .agents.find((item) => item.profile.id === run.agent.profile.id);
    if (!agent) throw Error(t('error.createStudioRunHost.agentMissingFromTheProject'));
    const saved = state ? state.session : agent.session;
    if (saved?.id !== run.agent.session?.id || saved?.path !== run.agent.session?.path)
      throw Error(t('Chat.resetChanged'));
    if (state) await atomicJson(join(root, 'state.json'), { ...state, session: undefined });
    else await store.projects.updateRuntime(run.project.id, agent.profile.id, 'idle', null);
  });
}
