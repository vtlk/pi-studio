import type { Agent } from '../../shared/studio.ts';
import type { WorkspaceProject, ProjectAgent } from '../../shared/project.ts';
import { storageSections, type StorageSection, type StudioSections } from '../../shared/storage.ts';

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
  if (item.requiresSceneApproval !== undefined)
    agent.requiresSceneApproval = boolean(item.requiresSceneApproval);
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
export function snapshotAgent(agent: Agent): ProjectAgent {
  const {
    instructions: _instructions,
    mainInstruction: _mainInstruction,
    ...profile
  } = parseAgent(agent);
  return { profile, outputPath: `agents/${profile.id}/output`, entries: [] };
}

export function parseProject(value: unknown): WorkspaceProject {
  const item = record(value);
  if (item.schemaVersion !== 1) throw new Error('Неподдерживаемая версия project.json.');
  const agents = list(item.agents).map((value): ProjectAgent => {
    const saved = record(value);
    const profile = record(saved.profile);
    if ('instructions' in profile || 'mainInstruction' in profile)
      throw new Error('Проект не должен хранить копии инструкций.');
    const agent = snapshotAgent(parseAgent({ ...profile, instructions: [] }));
    if (saved.outputPath !== agent.outputPath) throw new Error('Некорректный путь выходов агента.');
    if (saved.session !== undefined) {
      const binding = record(saved.session);
      const path = text(binding.path, 1000);
      if (
        !path.startsWith(`agents/${agent.profile.id}/sessions/`) ||
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
  });
  if (new Set(agents.map((agent) => agent.profile.id)).size !== agents.length)
    throw new Error('Повторяющиеся ID снимка.');
  return {
    id: stableId(item.id),
    name: text(item.name, 500),
    createdAt: timestamp(item.createdAt),
    agents,
    autoContinue: false,
  };
}
export function projectDocument(project: WorkspaceProject) {
  return {
    schemaVersion: 1,
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
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
      if (!['codex', 'images', 'pi', 'compatible', 'local'].includes(String(item.purpose)))
        throw new Error('Некорректный тип подключения.');
      return {
        ...base,
        purpose: item.purpose,
        providerId: text(item.providerId, 500),
        endpoint: text(item.endpoint, 2000),
        account: text(item.account, 500),
      };
    }
    if (!['skills', 'mcps', 'plugins'].includes(String(item.kind)))
      throw new Error('Некорректный тип ресурса.');
    const credential = text(item.credential, 500);
    if (credential && !/^keychain:[a-zA-Z0-9_.-]+$/.test(credential))
      throw new Error('Сохраняйте только ссылку keychain:имя, без секретов.');
    return {
      ...base,
      kind: item.kind,
      source: text(item.source, 2000),
      version: text(item.version, 500),
      description: text(item.description),
      transport: text(item.transport, 100),
      args: text(item.args, 10_000),
      credential,
      contents: text(item.contents),
      ...(item.localSkill === true ? { localSkill: true } : {}),
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
