import { isDeepStrictEqual } from 'node:util';
import { t } from '../../shared/i18n/index.ts';
import { builtinResources } from '../../shared/builtinResources.ts';
import type { Resource } from '../../shared/resources.ts';
import type { SystemAgent } from '../../shared/systemAgents.ts';
import type { StudioService, StudioStore } from '../storage/StudioStore.ts';
import { boolean, record, stableId, text } from '../storage/validationFields.ts';
import { assertSetupInspectionScope } from './administrationScope.ts';
import { catalogPage } from './catalogReads.ts';
import { inspectCatalogSkill } from './catalogResourceEdits.ts';
import type { PreparedRun } from './ContextBuilder.ts';

const searchSections = ['prompt', 'instructions', 'skills', 'mcps'] as const;
type Section = (typeof searchSections)[number];
const invalid = () => Error(t('HelperInspection.invalid'));

function array(value: unknown, max: number) {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > max ||
    new Set(value).size !== value.length
  )
    throw invalid();
  return value;
}
const selectedIds = (value: unknown) =>
  value === undefined ? undefined : array(value, 20).map(stableId);
const lower = (value: string) => value.normalize('NFC').toLowerCase();
function term(value: unknown) {
  const key = lower(text(value, 160).trim());
  if (!key) throw invalid();
  return key;
}
function searchGroups({ query, queries }: Record<string, unknown>) {
  if (query !== undefined) {
    if (queries !== undefined) throw invalid();
    return [{ id: 'query', terms: [term(query)], match: 'any' }];
  }
  const groups = array(queries, 16).map((value) => {
    const group = record(value);
    const id = stableId(group.id);
    if (
      id.length > 64 ||
      (group.match !== undefined && group.match !== 'any' && group.match !== 'all')
    )
      throw invalid();
    return { id, terms: array(group.terms, 12).map(term), match: group.match ?? 'any' };
  });
  if (
    new Set(groups.map(({ id }) => id)).size !== groups.length ||
    Buffer.byteLength(JSON.stringify(queries)) > 3000
  )
    throw invalid();
  return groups;
}
type SearchGroup = ReturnType<typeof searchGroups>[number];

function documents(
  store: StudioStore,
  args: Record<string, unknown>,
  sections: Section[],
  includeDisabled: boolean,
) {
  const { teams, agents } = store.agentCatalog();
  const storeSections = store.bootstrap().sections;
  const teamId = args.team_id === undefined ? undefined : stableId(args.team_id);
  const team = teamId ? teams.find(({ id }) => id === teamId) : undefined;
  if (teamId && !team) throw Error(t('TeamTransfers.theTeamIsUnavailable'));
  const agentIds = selectedIds(args.agent_ids);
  const resourceIds = selectedIds(args.resource_ids);
  const profiles = [...agents, ...(storeSections.systemAgents as SystemAgent[])].filter(
    ({ id }) => (!team || team.agentIds.includes(id)) && (!agentIds || agentIds.includes(id)),
  );
  if (agentIds?.some((id) => !profiles.some((agent) => agent.id === id)))
    throw Error(t('HelperInspection.agentMissing'));
  const prompts: {
    section: Section;
    agentId: string;
    agentName: string;
    instructionId?: string;
    name?: string;
    enabled: boolean;
    content: string;
  }[] = [];
  const assignments = new Set<string>();
  for (const agent of profiles) {
    const identity = { agentId: agent.id, agentName: agent.name };
    if (sections.includes('prompt') && agent.mainInstruction)
      prompts.push({
        ...identity,
        section: 'prompt',
        enabled: true,
        content: agent.mainInstruction,
      });
    if (sections.includes('instructions')) {
      for (const { id, name, content, enabled } of agent.instructions)
        if (enabled || includeDisabled)
          prompts.push({
            ...identity,
            section: 'instructions',
            instructionId: id,
            name,
            enabled,
            content,
          });
    }
    for (const kind of ['skills', 'mcps'] as const) {
      if (!sections.includes(kind)) continue;
      for (const id of agent[kind])
        if (includeDisabled || agent.capabilitySettings?.[`${kind}:${id}`]?.enabled !== false)
          assignments.add(id);
    }
  }
  const resources = [...(storeSections.resources as Resource[]), ...builtinResources].filter(
    ({ id, kind }) =>
      sections.includes(kind as Section) &&
      (!resourceIds || resourceIds.includes(id)) &&
      (!(team || agentIds) || assignments.has(id)),
  );
  return { prompts, resources };
}

function matches(content: string, groups: SearchGroup[]) {
  const original = content.normalize('NFC');
  const value = original.toLowerCase();
  return groups.flatMap(({ id, terms, match }) => {
    const indices = terms.map((word) => value.indexOf(word));
    const found = indices.filter((index) => index >= 0);
    if (!found.length || (match === 'all' && found.length !== terms.length)) return [];
    const index = Math.min(...found);
    const start = Math.max(0, index - 55);
    const snippet = original
      .slice(start, index + 130)
      .replace(/\s+/g, ' ')
      .trim();
    return [
      {
        queryId: id,
        snippet: (start ? '…' : '') + snippet + (index + 130 < original.length ? '…' : ''),
      },
    ];
  });
}

export async function searchAgentSettings(
  service: StudioService,
  run: PreparedRun,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const groups = searchGroups(args);
  const includeDisabled =
    args.include_disabled === undefined ? false : boolean(args.include_disabled);
  const sections =
    args.sections === undefined
      ? args.resource_ids === undefined
        ? ['prompt', 'instructions']
        : ['skills', 'mcps']
      : array(args.sections, 4);
  if (sections.some((section) => !searchSections.includes(section))) throw invalid();
  const read = () =>
    service.serialize(async () => {
      signal?.throwIfAborted();
      const store = await service.load();
      assertSetupInspectionScope(store, run);
      return { store, ...documents(store, args, sections as Section[], includeDisabled) };
    });
  const { store, prompts, resources } = await read();
  const rows: { queryId: string; snippet: string }[] = [];
  const unsearchedSkills: string[] = [];
  for (const { content, ...identity } of prompts)
    for (const match of matches([identity.name, content].filter(Boolean).join('\n'), groups))
      rows.push({ ...identity, ...match });
  // Bound simultaneous disk access and keep the Studio mutation queue free.
  for (let i = 0; i < resources.length; i += 8) {
    signal?.throwIfAborted();
    const batch = await Promise.all(
      resources.slice(i, i + 8).map(async (resource) => {
        const { id, name, kind, description, source } = resource;
        let body = '';
        if (kind === 'skills' && resource.localSkill) {
          try {
            body = (await inspectCatalogSkill(store, resource)).content;
          } catch {
            unsearchedSkills.push(id);
          }
        } else if (kind === 'skills') unsearchedSkills.push(id);
        if (kind === 'mcps' && /^pi:[a-zA-Z0-9_-]+$/.test(source)) body = source.slice(3);
        return matches(`${name}\n${description}\n${body}`, groups).map((match) => ({
          resourceId: id,
          section: kind,
          name,
          ...match,
        }));
      }),
    );
    rows.push(...batch.flat());
  }
  const current = await read();
  if (
    store !== current.store ||
    !isDeepStrictEqual([prompts, resources], [current.prompts, current.resources])
  )
    throw Error(t('SettingsRead.changed'));
  const { start, limit, offset, max_bytes, fingerprint } = args;
  const queryMatchCounts = Object.fromEntries(groups.map(({ id }) => [id, 0]));
  for (const { queryId } of rows) queryMatchCounts[queryId]++;
  return catalogPage(
    'search_agent_settings',
    rows,
    { start, limit, offset, max_bytes, fingerprint },
    {
      queryMatchCounts,
      unsearchedSkillContentCount: unsearchedSkills.length,
    },
  );
}
