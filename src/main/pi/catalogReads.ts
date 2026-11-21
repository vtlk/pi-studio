import { t } from '../../shared/i18n/index.ts';
import type { Connection } from '../../shared/connections.ts';
import type { PiModelCatalog } from '../../shared/models.ts';
import type { Resource } from '../../shared/resources.ts';
import type { SystemAgent } from '../../shared/systemAgents.ts';
import { builtinResources } from '../../shared/builtinResources.ts';
import type { StudioStore } from '../storage/StudioStore.ts';
import { stableId } from '../storage/validation.ts';
import { settingsOutput } from './settingsOutput.ts';

export const catalogReadNames = [
  'list_teams',
  'list_agents',
  'list_resources',
  'list_connections',
  'list_models',
  'list_native_mcps',
];
export type ReadModelCatalog = (
  connection?: Connection,
  expectedFolder?: string,
) => Promise<PiModelCatalog>;

function query(args: Record<string, unknown>) {
  if (args.query !== undefined && (typeof args.query !== 'string' || args.query.length > 200))
    throw Error(t('SettingsRead.invalid'));
  const value = String(args.query ?? '')
    .trim()
    .toLowerCase();
  return (...fields: string[]) =>
    !value || fields.some((field) => field.toLowerCase().includes(value));
}

export function catalogPage(
  tool: string,
  rows: object[],
  args: Record<string, unknown>,
  summary = {},
) {
  const start = args.start ?? 0;
  const limit = args.limit ?? 20;
  if (
    typeof start !== 'number' ||
    !Number.isSafeInteger(start) ||
    start < 0 ||
    typeof limit !== 'number' ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 50
  )
    throw Error(t('SettingsRead.invalid'));
  const { offset, fingerprint, max_bytes, ...target } = args;
  return settingsOutput(
    {
      ...summary,
      items: rows.slice(start, start + limit),
      count: rows.length,
      nextPage:
        start + limit < rows.length
          ? { tool, arguments: { ...target, start: start + limit, limit } }
          : null,
    },
    { offset, fingerprint, max_bytes },
    { tool, target },
  );
}

export function catalogConnection(store: StudioStore, id: unknown) {
  const connectionId = stableId(id);
  const connection = (store.bootstrap().sections.connections as Connection[]).find(
    (item) => item.id === connectionId && item.purpose !== 'images',
  );
  if (!connection) throw Error(t('error.setupAdministration.connectionMissing'));
  return connection;
}

export function compactModelRows(
  catalog: PiModelCatalog,
  connection: Connection,
  args: Record<string, unknown>,
) {
  const matches = query(args);
  return catalog.models
    .filter((model) => model.provider === connection.providerId && matches(model.id, model.name))
    .map(({ id, name, imageInput, reasoningLevels, defaultReasoningLevel }) => ({
      id,
      name,
      imageInput,
      reasoningLevels,
      defaultReasoningLevel,
    }));
}

export function compactCatalogRows(
  store: StudioStore,
  name: string,
  args: Record<string, unknown>,
) {
  const matches = query(args);
  const { teams, agents } = store.agentCatalog();
  const sections = store.bootstrap().sections;
  if (name === 'list_teams')
    return teams
      .filter(({ id, name }) => matches(id, name))
      .map(({ id, name, workspaceMode, agentIds }) => ({
        id,
        name,
        workspaceMode: workspaceMode ?? 'per-agent',
        agentCount: agentIds.length,
      }));
  if (name === 'list_agents') {
    if (args.scope === 'system') {
      if (args.team_id !== undefined) throw Error(t('SettingsRead.invalid'));
      return (sections.systemAgents as SystemAgent[])
        .filter(({ id, name }) => matches(id, name))
        .map(({ id, name, enabled, systemRole }) => ({ id, name, enabled, systemRole }));
    }
    if (
      args.scope !== undefined ||
      (args.team_id === undefined && !String(args.query ?? '').trim())
    )
      throw Error(t('CatalogRead.agentFilterRequired'));
    const teamId = args.team_id === undefined ? undefined : stableId(args.team_id);
    const selected = teamId ? teams.filter(({ id }) => id === teamId) : teams;
    if (teamId && !selected.length) throw Error(t('TeamTransfers.theTeamIsUnavailable'));
    const profiles = new Map(agents.map((agent) => [agent.id, agent]));
    return selected.flatMap((team) =>
      team.agentIds.flatMap((id, order) => {
        const profile = profiles.get(id);
        return profile && matches(id, profile.name)
          ? [{ id, name: profile.name, enabled: profile.enabled, order, teamId: team.id }]
          : [];
      }),
    );
  }
  if (name === 'list_connections')
    return (sections.connections as Connection[])
      .filter(({ id, name, providerId }) => matches(id, name, providerId))
      .map(({ id, name, providerId, purpose }) => ({ id, name, provider: providerId, purpose }));
  if (name === 'list_resources') {
    if (!['skills', 'mcps', 'plugins'].includes(String(args.kind)))
      throw Error(t('SettingsRead.invalid'));
    return [...(sections.resources as Resource[]), ...builtinResources]
      .filter(
        ({ id, name, kind, description }) => kind === args.kind && matches(id, name, description),
      )
      .map(({ id, name, kind, description, source, check }) => ({
        id,
        name,
        kind,
        description: description.slice(0, 180),
        builtin: source.startsWith('builtin:'),
        status: check?.status ?? 'unconfirmed',
      }));
  }
  throw Error(t('SettingsRead.invalid'));
}

export function compactNativeMcpRows(
  servers: readonly { name: string; transport: string; description: string; enabled: boolean }[],
  args: Record<string, unknown>,
) {
  const matches = query(args);
  return servers
    .filter(({ name }) => matches(name))
    .map(({ name, transport, enabled }) => ({ name, transport, enabled }));
}
