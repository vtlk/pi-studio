import { t } from '../../shared/i18n/index.ts';
import { join } from 'node:path';
import type { StudioService } from '../storage/StudioStore.ts';
import type { RunHost } from '../pi/RunHost.ts';
import type { SystemAgent } from '../../shared/systemAgents.ts';
import type { Connection } from '../../shared/connections.ts';
import type { TeamSetupResult, TeamImportReport } from '../../shared/teamPackage.ts';
import { validateAgentModel } from '../../shared/modelConfiguration.ts';
import { atomicJson } from '../storage/files.ts';
import { readImport } from './importState.ts';

type AssistantHost = Pick<RunHost, 'launch' | 'launchServiceTask' | 'assertIdle'>;
const mcpHandoffState = (report: TeamImportReport) =>
  report.mcpHandoff ??
  (report.handoff === 'sending' || report.handoff === 'uncertain' ? report.handoff : 'pending');
export async function handoffTeamImport(
  service: StudioService,
  setup: AssistantHost,
  folder: string,
  id: string,
): Promise<TeamSetupResult> {
  const pending = await service.serialize(async () => {
    const store = await service.load();
    if (store.folder !== folder) throw new Error(t('registerTeamHandlers.studioFolderChanged'));
    const imported = await readImport(store, id),
      sections = store.bootstrap().sections;
    const assistant = (sections.systemAgents as SystemAgent[]).find(
      (agent) => agent.systemRole === 'assistant',
    )!;
    return {
      ...imported,
      assistant,
      configured:
        assistant.enabled &&
        validateAgentModel(assistant.model, (sections.connections ?? []) as Connection[]).ok,
    };
  });
  const base = { report: pending.state.report, assistantId: pending.assistant.id };
  if (!pending.configured) return { ...base, outcome: 'needs_configuration' };
  try {
    setup.assertIdle();
  } catch {
    return {
      ...base,
      outcome: 'busy',
      message: t('error.handoffTeamImport.theAssistantIsBusyThe'),
    };
  }
  const send = mcpHandoffState(pending.state.report) === 'pending';
  const request = {
    projectId: 'pi-setup-assistant',
    agentId: pending.assistant.id,
    autoContinue: false,
  };
  try {
    if (send) {
      const message = teamMcpSetupPrompt(
        pending.state.report.teamName,
        pending.state.report.teamId,
        id,
      );
      await setup.launchServiceTask(request, message, () =>
        service.serialize(async () => {
          const store = await service.load();
          if (store.folder !== folder)
            throw new Error(t('registerTeamHandlers.studioFolderChanged'));
          const current = await readImport(store, id);
          if (mcpHandoffState(current.state.report) !== 'pending')
            throw new Error(t('error.handoffTeamImport.thisTaskWasAlreadyHanded'));
          current.state.report.mcpHandoff = 'sending';
          current.state.report.handoff = 'sending';
          await atomicJson(join(current.root, 'state.json'), current.state);
        }),
      );
    } else await setup.launch(request);
  } catch (error) {
    const report = await service.serialize(async () => {
      const store = await service.load();
      if (store.folder !== folder) throw new Error(t('registerTeamHandlers.studioFolderChanged'));
      const current = await readImport(store, id);
      if (current.state.report.mcpHandoff === 'sending') {
        current.state.report.mcpHandoff = 'uncertain';
        current.state.report.handoff = 'uncertain';
        await atomicJson(join(current.root, 'state.json'), current.state);
      }
      return current.state.report;
    });
    return {
      report,
      assistantId: pending.assistant.id,
      outcome: mcpHandoffState(report) === 'pending' ? 'pending' : 'uncertain',
      message:
        error instanceof Error
          ? error.message
          : t('error.handoffTeamImport.taskDeliveryUnconfirmedItWill'),
    };
  }
  const report = await service.serialize(async () => {
    const store = await service.load();
    if (store.folder !== folder) throw new Error(t('registerTeamHandlers.studioFolderChanged'));
    return (await readImport(store, id)).state.report;
  });
  return {
    report,
    assistantId: pending.assistant.id,
    outcome:
      !send && ['sending', 'uncertain'].includes(mcpHandoffState(report)) ? 'uncertain' : 'opened',
  };
}

export function teamMcpSetupPrompt(name: string, teamId: string, packageId: string) {
  return t('Onboarding.assistantPrompt', { name: JSON.stringify(name), teamId, packageId });
}
