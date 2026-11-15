import type { Agent } from '../../shared/studio.ts';
import type { WorkspaceProject, ProjectAgent } from '../../shared/project.ts';
import { storageSections, type StorageSection, type StudioSections } from '../../shared/storage.ts';
import { agentDirectory, agentFolderSlug } from '../../shared/agentPaths.ts';
import { systemAgentRoles, type SystemAgent } from '../../shared/systemAgents.ts';
import { modelEndpointUrl, parseModelEndpoint } from '../../shared/modelEndpoint.ts';
import type { AgentCatalog, AgentTeam } from '../../shared/agentTeams.ts';

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Ожидался объект данных.');
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 200_000): string {
  if (typeof value !== 'string' || value.length > max)
    throw new Error('Некорректное текстовое поле.');
  return value;
}
export function stableId(value: unknown): string {
  const id = text(value, 128);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) throw new Error('Некорректный ID.');
  return id;
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Некорректный переключатель.');
  return value;
}
function timestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new Error('Некорректная дата.');
  return value;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 10_000) throw new Error('Некорректный список.');
  return value;
}
function strings(value: unknown) {
  return list(value).map((item) => text(item, 2000));
}

export function parseAgent(value: unknown): Agent {
  const item = record(value);
  const agent: Agent = {
    id: stableId(item.id),
    name: text(item.name, 500),
    enabled: boolean(item.enabled),
    skills: strings(item.skills),
    mcps: strings(item.mcps),
    plugins: strings(item.plugins),
    instructions: list(item.instructions ?? []).map((value) => {
      const instruction = record(value);
      return {
        id: stableId(instruction.id),
        name: text(instruction.name, 500),
        content: text(instruction.content),
        enabled: boolean(instruction.enabled),
      };
    }),
  };
  if (item.mainInstruction !== undefined) agent.mainInstruction = text(item.mainInstruction);
  if (item.capabilitySettings !== undefined)
    agent.capabilitySettings = Object.fromEntries(
      Object.entries(record(item.capabilitySettings)).map(([key, value]) => [
        key,
        { enabled: boolean(record(value).enabled) },
      ]),
    );
  if (item.model !== undefined) {
    const model = record(item.model);
    agent.model = {
      provider: text(model.provider, 500),
      id: text(model.id, 500),
      reasoning: text(model.reasoning, 100),
      temperature: text(model.temperature, 100),
    };
    if (model.connectionId !== undefined) agent.model.connectionId = text(model.connectionId, 500);
  }
  return agent;
}
export function parseAgents(value: unknown): Agent[] {
  const agents = list(value).map(parseAgent);
  if (new Set(agents.map((agent) => agent.id)).size !== agents.length)
    throw new Error('Повторяющиеся ID агентов.');
  return agents;
}
export function parseTeams(value: unknown): AgentTeam[] {
  if (!Array.isArray(value) || value.length > 1000) throw new Error('Некорректный список команд.');
  const teams = value.map((value) => {
    const item = record(value);
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 500)
      throw new Error('Назовите команду агентов.');
    if (!Array.isArray(item.agentIds) || item.agentIds.length > 10000)
      throw new Error('Некорректный состав команды.');
    return { id: stableId(item.id), name: item.name.trim(), agentIds: item.agentIds.map(stableId) };
  });
  if (new Set(teams.map((team) => team.id)).size !== teams.length)
    throw new Error('Повторяющийся ID команды.');
  return teams;
}
export function parseAgentCatalog(value: unknown): AgentCatalog {
  const item = record(value);
  const agents = parseAgents(item.agents);
  const teams = parseTeams(item.teams);
  const members = teams.flatMap((team) => team.agentIds);
  if (
    new Set(members).size !== members.length ||
    members.length !== agents.length ||
    members.some((id) => !agents.some((agent) => agent.id === id))
  )
    throw new Error('Каждый обычный агент должен принадлежать ровно одной команде.');
  return {
    agents: teams.flatMap((team) =>
      team.agentIds.map((id) => agents.find((agent) => agent.id === id)!),
    ),
    teams,
  };
}
export function parseSystemAgents(value: unknown): SystemAgent[] {
  const profiles = list(value).map((value) => {
    const item = record(value);
    if (!systemAgentRoles.includes(item.systemRole as SystemAgent['systemRole']))
      throw new Error('Неизвестный системный агент.');
    return { ...parseAgent(item), systemRole: item.systemRole as SystemAgent['systemRole'] };
  });
  if (
    !(profiles.length === 3 || (profiles.length === 1 && profiles[0].systemRole === 'assistant')) ||
    new Set(profiles.map((item) => item.systemRole)).size !== profiles.length ||
    new Set(profiles.map((item) => item.id)).size !== profiles.length
  )
    throw new Error('Системного помощника нельзя удалять или добавлять вручную.');
  return profiles;
}
export function snapshotAgent(agent: Agent): ProjectAgent {
  const {
    instructions: _instructions,
    mainInstruction: _mainInstruction,
    ...profile
  } = parseAgent(agent);
  return { profile, outputPath: `agents/${agentFolderSlug(profile.name)}/output`, entries: [] };
}

export function snapshotProjectAgents(agents: Agent[], reserved: string[] = []) {
  const used = new Set(reserved.map((name) => name.toLowerCase()));
  return agents.map((agent) => {
    const snapshot = snapshotAgent(agent);
    const slug = agentFolderSlug(agent.name);
    let folder = slug;
    for (let suffix = 2; used.has(folder.toLowerCase()); suffix++) folder = `${slug}-${suffix}`;
    used.add(folder.toLowerCase());
    return { ...snapshot, outputPath: `agents/${folder}/output` };
  });
}

function parseProjectAgent(value: unknown): ProjectAgent {
  const saved = record(value);
  const profile = record(saved.profile);
  if ('instructions' in profile || 'mainInstruction' in profile)
    throw new Error('Проект не должен хранить копии инструкций.');
  const agent = snapshotAgent(parseAgent({ ...profile, instructions: [] }));
  agent.outputPath = text(saved.outputPath, 500);
  const directory = agentDirectory(agent.outputPath);
  if (saved.session !== undefined) {
    const binding = record(saved.session);
    const path = text(binding.path, 1000);
    if (
      !path.startsWith(`${directory}/sessions/`) ||
      path.includes('..') ||
      !path.endsWith('.jsonl')
    )
      throw new Error('Некорректный путь сессии Pi.');
    agent.session = {
      id: stableId(binding.id),
      title: text(binding.title, 500),
      path,
      createdAt: timestamp(binding.createdAt),
      needsFork: binding.needsFork === true,
    };
  }
  return agent;
}

export function parseProject(value: unknown): WorkspaceProject {
  const item = record(value);
  if (item.schemaVersion !== 1) throw new Error('Неподдерживаемая версия project.json.');
  const agents = list(item.agents).map(parseProjectAgent);
  if (new Set(agents.map((agent) => agent.profile.id)).size !== agents.length)
    throw new Error('Повторяющиеся ID снимка.');
  const project: WorkspaceProject = {
    ...(item.sourceTeamId === undefined ? {} : { sourceTeamId: stableId(item.sourceTeamId) }),
    id: stableId(item.id),
    name: text(item.name, 500),
    createdAt: timestamp(item.createdAt),
    agents,
    autoContinue: false,
    ...(item.archivedAgents === undefined
      ? {}
      : {
          archivedAgents: list(item.archivedAgents).map((value) => {
            const archive = record(value);
            const agent = parseProjectAgent(archive.agent);
            if (agents.some((item) => item.profile.id === agent.profile.id))
              throw new Error('Удалённый агент одновременно активен.');
            const position = timestamp(archive.position);
            if (!Number.isInteger(position) || position > 10000)
              throw new Error('Некорректная позиция удалённого агента.');
            return { agent, position };
          }),
        }),
  };
  const all = [...project.agents, ...(project.archivedAgents ?? []).map((item) => item.agent)];
  if (new Set(all.map((agent) => agent.outputPath.toLowerCase())).size !== all.length)
    throw new Error('Повторяющиеся папки агентов.');
  return project;
}
export function projectDocument(project: WorkspaceProject) {
  return {
    schemaVersion: 1,
    sourceTeamId: project.sourceTeamId,
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    archivedAgents: project.archivedAgents?.map(
      ({ agent: { profile, outputPath, session }, position }) => ({
        agent: { profile, outputPath, session },
        position,
      }),
    ),
    agents: project.agents.map(({ profile, outputPath, session }) => ({
      profile,
      outputPath,
      session,
    })),
  };
}

export function parseSection(section: unknown, value: unknown): unknown {
  if (!storageSections.includes(section as StorageSection))
    throw new Error('Неизвестный раздел настроек.');
  if (section === 'agents') return parseAgents(value);
  if (section === 'agentTeams') return parseTeams(value);
  if (section === 'agentCatalog') return parseAgentCatalog(value);
  if (section === 'systemAgents') return parseSystemAgents(value);
  if (section === 'libraryAgents') {
    const item = record(value);
    return { characters: text(item.characters, 128), locations: text(item.locations, 128) };
  }
  if (section === 'baseInstruction' || section === 'piPath') return text(value);
  if (section === 'hiddenLibraryIds') return strings(value);
  if (section === 'imageTool') {
    const item = record(value);
    return { connectionId: text(item.connectionId, 500), modelId: text(item.modelId, 500) };
  }
  return list(value).map((value) => {
    const item = record(value);
    const base = {
      id: text(item.id, 500),
      name: text(item.name, 500),
      createdAt: timestamp(item.createdAt),
    };
    if (section === 'connections') {
      if (
        item.authScope !== undefined &&
        !['native', 'connection'].includes(String(item.authScope))
      )
        throw new Error('Некорректная область авторизации подключения.');
      if (!['codex', 'images', 'pi', 'compatible', 'local'].includes(String(item.purpose)))
        throw new Error('Некорректный тип подключения.');
      return {
        ...base,
        purpose: item.purpose,
        ...(item.authScope === undefined ? {} : { authScope: item.authScope }),
        providerId: text(item.providerId, 500),
        endpoint: text(item.endpoint, 2000),
        ...(item.endpointConfig === undefined
          ? {}
          : {
              endpoint: modelEndpointUrl(text(item.endpoint, 2000)),
              endpointConfig: parseModelEndpoint(item.endpointConfig),
            }),
        account: text(item.account, 500),
      };
    }
    if (!['skills', 'mcps', 'plugins'].includes(String(item.kind)))
      throw new Error('Некорректный тип ресурса.');
    const credential = text(item.credential, 500);
    if (credential && !/^keychain:[a-zA-Z0-9_.-]+$/.test(credential))
      throw new Error('Сохраняйте только ссылку keychain:имя, без секретов.');
    const names = item.mcpSecretNames;
    if (
      names !== undefined &&
      (!Array.isArray(names) ||
        names.length > 64 ||
        names.some((name) => typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)))
    )
      throw new Error('Некорректные имена защищённых параметров MCP.');
    return {
      ...base,
      kind: item.kind,
      source: text(item.source, 2000),
      version: text(item.version, 500),
      description: text(item.description),
      transport: text(item.transport, 100),
      args: text(item.args, 10_000),
      credential,
      ...(Array.isArray(names) ? { mcpSecretNames: [...new Set(names)] } : {}),
      contents: text(item.contents),
      ...(item.localSkill === true ? { localSkill: true } : {}),
      ...(item.managedSkill === true ? { managedSkill: true } : {}),
      ...(item.check === undefined
        ? {}
        : {
            check: (() => {
              const check = record(item.check);
              if (
                !['available', 'needs_auth', 'unavailable', 'disabled'].includes(
                  String(check.status),
                )
              )
                throw new Error('Некорректный статус проверки ресурса.');
              const toolCount = check.toolCount;
              if (
                toolCount !== undefined &&
                (typeof toolCount !== 'number' || !Number.isSafeInteger(toolCount) || toolCount < 0)
              )
                throw new Error('Некорректное число инструментов.');
              return {
                status: check.status,
                checkedAt: timestamp(check.checkedAt),
                ...(toolCount === undefined ? {} : { toolCount }),
              };
            })(),
          }),
    };
  });
}
export function parseStudio(value: unknown): StudioSections {
  const document = record(value);
  if (document.schemaVersion !== 1)
    throw new Error('Неподдерживаемая версия studio.json. Файл не изменён.');
  const entries = Object.entries(record(document.sections));
  return Object.fromEntries(entries.map(([key, value]) => [key, parseSection(key, value)]));
}
