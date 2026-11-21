import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { builtinResource } from '../../shared/builtinResources.ts';
import { requiredBuiltinMcpIds } from '../../shared/builtinAssignments.ts';
import type { Connection } from '../../shared/connections.ts';
import { t } from '../../shared/i18n/index.ts';
import { validateAgentModel } from '../../shared/modelConfiguration.ts';
import { parseReasoning, resolveReasoning } from '../../shared/reasoning.ts';
import type { Resource } from '../../shared/resources.ts';
import type { Agent } from '../../shared/studio.ts';
import type { SystemAgent } from '../../shared/systemAgents.ts';
import type { StudioService, StudioStore } from '../storage/StudioStore.ts';
import { boolean, stableId, text } from '../storage/validationFields.ts';
import { assertAdministrationScope } from './administrationScope.ts';
import type { ReadModelCatalog } from './catalogReads.ts';
import type { PreparedRun } from './ContextBuilder.ts';

function profile(store: StudioStore, id: unknown): Agent | SystemAgent {
  const agentId = stableId(id);
  const agent = store.agentCatalog().agents.find((item) => item.id === agentId);
  const systems = store.bootstrap().sections.systemAgents as SystemAgent[];
  const found = agent ?? systems.find((item) => item.id === agentId);
  if (!found) throw Error(t('error.setupAdministration.theRequestedProfileIsMissing'));
  return found;
}

async function saveProfile(store: StudioStore, agent: Agent | SystemAgent) {
  if ('systemRole' in agent) {
    const systems = store.bootstrap().sections.systemAgents as SystemAgent[];
    await store.saveSection(
      'systemAgents',
      systems.map((item) => (item.id === agent.id ? agent : item)),
    );
  } else {
    const catalog = store.agentCatalog();
    await store.saveSection('agentCatalog', {
      ...catalog,
      agents: catalog.agents.map((item) => (item.id === agent.id ? agent : item)),
    });
  }
  return { agentId: agent.id, updatedProjectSnapshots: false };
}

export async function editAgentInstruction(store: StudioStore, args: Record<string, unknown>) {
  const agent = profile(store, args.agent_id);
  const { action, name, content, enabled } = args;
  const editing = name !== undefined || content !== undefined || enabled !== undefined;
  const patch = {
    ...(name === undefined ? {} : { name: text(name, 500) }),
    ...(content === undefined ? {} : { content: text(content) }),
    ...(enabled === undefined ? {} : { enabled: boolean(enabled) }),
  };
  if (action === 'add') {
    if (
      args.instruction_id !== undefined ||
      patch.name === undefined ||
      patch.content === undefined
    )
      throw Error(t('ProfileEdit.invalid'));
    const instruction = {
      ...patch,
      id: randomUUID(),
      name: patch.name,
      content: patch.content,
      enabled: patch.enabled ?? true,
    };
    return {
      ...(await saveProfile(store, {
        ...agent,
        instructions: [...agent.instructions, instruction],
      })),
      instructionId: instruction.id,
      action,
      enabled: instruction.enabled,
    };
  }
  if ((action !== 'update' && action !== 'remove') || editing !== (action === 'update'))
    throw Error(t('ProfileEdit.invalid'));
  const id = stableId(args.instruction_id);
  const matches = agent.instructions.filter((item) => item.id === id);
  if (!matches.length) throw Error(t('CatalogRead.instructionMissing'));
  if (matches.length !== 1) throw Error(t('ProfileEdit.duplicateInstruction'));
  const updated = { ...matches[0], ...patch };
  const instructions =
    action === 'remove'
      ? agent.instructions.filter((item) => item.id !== id)
      : agent.instructions.map((item) => (item.id === id ? updated : item));
  return {
    ...(await saveProfile(store, { ...agent, instructions })),
    instructionId: id,
    action,
    ...(action === 'update' ? { enabled: updated.enabled } : {}),
  };
}

export async function editResourceAssignment(store: StudioStore, args: Record<string, unknown>) {
  const agent = profile(store, args.agentId);
  const id = stableId(args.resourceId);
  const { kind } = args;
  if (kind !== 'skills' && kind !== 'mcps' && kind !== 'plugins')
    throw Error(t('error.setupAdministration.invalidResourceKind'));
  const remove = args.remove === undefined ? false : boolean(args.remove);
  const enabled = args.enabled === undefined ? true : boolean(args.enabled);
  if (remove && args.enabled !== undefined) throw Error(t('ProfileEdit.invalid'));
  if (kind === 'mcps' && (remove || !enabled) && requiredBuiltinMcpIds(agent).includes(id))
    throw Error(t('CapabilitiesPanel.requiredMcpCannotBeDisabledOrRemoved'));
  const ids = agent[kind];
  const resources = store.bootstrap().sections.resources as Resource[];
  if (
    !ids.includes(id) &&
    (remove ||
      !(
        builtinResource(id)?.kind === kind ||
        resources.some((item) => item.kind === kind && item.id === id)
      ))
  )
    throw Error(t('error.setupAdministration.resourceMissingFromTheCatalog'));
  const capabilitySettings = { ...agent.capabilitySettings };
  const key = `${kind}:${id}`;
  if (remove) delete capabilitySettings[key];
  else capabilitySettings[key] = { enabled };
  const updated = {
    ...agent,
    [kind]: remove ? ids.filter((item) => item !== id) : ids.includes(id) ? ids : [...ids, id],
    capabilitySettings,
  };
  return {
    ...(await saveProfile(store, updated)),
    resourceId: id,
    ...(remove ? { removed: true } : { enabled }),
    loadedInAgentSession: false,
  };
}

export async function setAgentReasoning(
  service: StudioService,
  run: PreparedRun,
  args: Record<string, unknown>,
  catalog: ReadModelCatalog,
) {
  const reasoning = parseReasoning(text(args.reasoning, 100));
  if (!reasoning) throw Error(t('error.reasoning.selectAValidAgentReasoning'));
  const read = async () => {
    const store = await service.load();
    await assertAdministrationScope(store, run);
    const agent = profile(store, args.agent_id);
    const connections = store.bootstrap().sections.connections as Connection[];
    // A profile with an empty old effort can still be completed through this tool.
    const selected = validateAgentModel(agent.model && { ...agent.model, reasoning }, connections);
    if (!selected.ok) throw Error(t('error.resolveAgentLaunchConfig.theAgentSConnectionIs'));
    return { store, agent, model: selected.model, connection: selected.connection };
  };
  const initial = await service.serialize(read);
  const models = await catalog(initial.connection, initial.store.folder);
  const selected = models.models.find(
    (item) => item.provider === initial.model.provider && item.id === initial.model.id,
  );
  if (!selected) throw Error(t('error.resolveAgentLaunchConfig.theSelectedModelIsMissing'));
  const effectiveReasoning = resolveReasoning(reasoning, selected);
  return service.serialize(async () => {
    const current = await read();
    if (
      current.store.folder !== initial.store.folder ||
      !isDeepStrictEqual(current.agent.model, initial.agent.model) ||
      !isDeepStrictEqual(current.connection, initial.connection)
    )
      throw Error(t('SettingsRead.changed'));
    return {
      ...(await saveProfile(current.store, { ...current.agent, model: current.model })),
      reasoning,
      effectiveReasoning,
      loadedInAgentSession: false,
    };
  });
}
