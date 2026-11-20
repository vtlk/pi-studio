import { join } from 'node:path';
import type { StudioService } from '../storage/StudioStore.ts';
import type { TeamCaller } from './types.ts';
import type { SystemAgent } from '../../shared/systemAgents.ts';
import { hasBuiltinMcp } from '../../shared/builtinAssignments.ts';
import { hasTeamMcp } from '../../shared/builtinResources.ts';
import { readStudioAgentSettings } from '../pi/readAgentSettings.ts';
import { t } from '../../shared/i18n/index.ts';
import { teamTools } from './tools.ts';
import { settingsOutput, settingsReadGuidance } from '../pi/settingsOutput.ts';

export const helperTeamTools = teamTools
  .filter((tool) => ['list_agents', 'read_agent_settings'].includes(tool.name))
  .map((tool) => ({
    ...tool,
    description:
      tool.name === 'list_agents'
        ? 'Setup assistant: list current Studio teams, ordinary and system profile IDs. Read-only catalog, not an open project or active session.'
        : 'Setup assistant: read current Studio constructor settings for an exact ordinary or system agent_id. No project required. Excludes secrets and runtime/session claims. ' +
          settingsReadGuidance,
  }));

/** The pinned helper has catalog-read authority, never an implicitly selected production project. */
export function helperTeamSettings(
  service: StudioService,
  run: TeamCaller,
  name: string,
  args: Record<string, unknown>,
) {
  return service.serialize(async () => {
    const store = await service.load();
    const helper = ((store.bootstrap().sections.systemAgents ?? []) as SystemAgent[]).find(
      (agent) => agent.systemRole === 'assistant' && agent.id === run.record.agentId,
    );
    if (
      run.project.id !== 'pi-setup-assistant' ||
      run.projectRoot !== join(store.folder, '.pistudio/setup-assistant') ||
      !helper?.enabled ||
      !hasTeamMcp(helper) ||
      !hasBuiltinMcp(helper, 'pistudio-administration')
    )
      throw Error(t('builtin.assignmentDisabled'));
    if (name === 'read_agent_settings')
      return settingsOutput(readStudioAgentSettings(store, args.agent_id), args);
    if (name === 'list_agents')
      return {
        scope: 'studio-constructor',
        teams: store.agentCatalog().teams,
        agents: store.agentCatalog().agents.map(({ id, name, enabled }) => ({ id, name, enabled })),
        systemAgents: [
          {
            id: helper.id,
            name: helper.name,
            enabled: helper.enabled,
            systemRole: helper.systemRole,
          },
        ],
      };
    throw Error(t('error.teamSupport.teamRequiresABindingTo'));
  });
}
