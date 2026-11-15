import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { TeamImportReport, TeamPackageManifest } from '../../shared/teamPackage.ts';
import type { Agent } from '../../shared/studio.ts';
import type { Resource } from '../../shared/resources.ts';
import { builtinResources } from '../../shared/builtinResources.ts';
import type { StudioStore } from '../storage/StudioStore.ts';
import { atomicJson, safePath } from '../storage/files.ts';
import { parseSkill } from '../storage/skills.ts';
import { decodePackage } from './packageCodec.ts';

export interface ImportedTeamState {
  report: TeamImportReport;
  agentMap: Record<string, string>;
  resourceMap: Record<string, string>;
}
export async function importTeam(store: StudioStore, bytes: Uint8Array): Promise<TeamImportReport> {
  const data = decodePackage(bytes),
    id = randomUUID(),
    teamId = randomUUID();
  const imports = await safePath(store.folder, '.pistudio/team-imports', true);
  await mkdir(imports, { recursive: true });
  const staging = await safePath(imports, `.importing-${id}`, true),
    final = await safePath(imports, id, true);
  await mkdir(staging);
  const resources: Resource[] = [],
    resourceMap: Record<string, string> = {},
    agentMap: Record<string, string> = {};
  let installed = false;
  try {
    for (const file of data.files) {
      const path = await safePath(staging, file.path, true);
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, Buffer.from(file.data, 'base64'), {
        flag: 'wx',
        mode: file.executable ? 0o755 : 0o644,
      });
    }
    for (const source of data.manifest.resources) {
      if (source.source.startsWith('builtin:')) {
        const builtin = builtinResources.find(
          (resource) => resource.source === source.source && resource.kind === source.kind,
        );
        if (!builtin || builtin.source === 'builtin:administration')
          throw new Error('Пакет требует неизвестный или административный встроенный MCP.');
        resourceMap[source.id] = builtin.id;
        continue;
      }
      const localId = randomUUID();
      resourceMap[source.id] = localId;
      const resource: Resource = {
        id: localId,
        name: source.name,
        kind: source.kind,
        source: source.filesRoot ? join(final, source.filesRoot) : source.source,
        description: source.description,
        version: source.version,
        transport: '',
        args: '',
        credential: '',
        contents: '',
        createdAt: Date.now(),
      };
      if (source.kind === 'skills') {
        if (!source.filesRoot) throw new Error('У навыка отсутствуют переносимые файлы.');
        const file = data.files.find((file) => file.path === source.filesRoot + '/SKILL.md')!;
        const skill = parseSkill(Buffer.from(file.data, 'base64').toString('utf8'));
        resource.name = skill.name;
        resource.description = skill.description;
        resource.localSkill = true;
      }
      if (source.kind === 'mcps') {
        if (!source.mcp) throw new Error('В пакете отсутствует конфигурация MCP.');
        resource.source = `pi:studio_import_${localId.replaceAll('-', '_')}`;
        resource.transport = typeof source.mcp.url === 'string' ? 'http' : 'stdio';
        resource.mcpSecretNames = [
          ...new Set(
            [...JSON.stringify(source.mcp).matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map(
              (match) => match[1],
            ),
          ),
        ];
        if (resource.mcpSecretNames.length) resource.credential = 'keychain:pistudio-mcp';
      }
      resources.push(resource);
    }
    const agents: Agent[] = data.manifest.agents.map((source) => {
      const agent = structuredClone(source);
      agent.id = randomUUID();
      agentMap[source.id] = agent.id;
      agent.instructions = agent.instructions.map((block) => ({ ...block, id: randomUUID() }));
      const settings: NonNullable<Agent['capabilitySettings']> = {};
      for (const kind of ['skills', 'mcps', 'plugins'] as const) {
        agent[kind] = source[kind].map((id) => resourceMap[id]);
        for (const id of source[kind])
          if (source.capabilitySettings?.[`${kind}:${id}`])
            settings[`${kind}:${resourceMap[id]}`] = source.capabilitySettings[`${kind}:${id}`];
      }
      agent.capabilitySettings = settings;
      // Imported account references are requirements, never local authorization or fallback.
      if (agent.model) agent.model.connectionId = '';
      return agent;
    });
    const report: TeamImportReport = {
      id,
      teamId,
      teamName: data.manifest.team.name,
      createdAt: Date.now(),
      handoff: 'pending',
      requirements: data.manifest.requirements,
      agents: agents.map((agent) => ({
        agentId: agent.id,
        name: agent.name,
        issues: importIssues(agent, data.manifest, resourceMap),
      })),
    };
    const state: ImportedTeamState = { report, agentMap, resourceMap };
    await writeFile(join(staging, 'package.pistudio-team'), bytes, { flag: 'wx', mode: 0o600 });
    await atomicJson(join(staging, 'state.json'), state);
    await rename(staging, final);
    await store.addImportedTeam(
      { id: teamId, name: report.teamName, agentIds: agents.map((agent) => agent.id) },
      agents,
      resources,
    );
    installed = true;
    return report;
  } finally {
    await rm(staging, { recursive: true, force: true });
    if (!installed) await rm(final, { recursive: true, force: true });
  }
}
function importIssues(
  agent: Agent,
  manifest: TeamPackageManifest,
  mapping: Record<string, string>,
) {
  const issues = [
    agent.model
      ? `Сопоставить подключение для ${agent.model.provider}/${agent.model.id}, effort ${agent.model.reasoning || 'не выбран'}.`
      : 'Выбрать подключение, модель и уровень рассуждения.',
  ];
  for (const kind of ['skills', 'mcps', 'plugins'] as const)
    for (const id of agent[kind]) {
      const resource = manifest.resources.find((resource) => mapping[resource.id] === id);
      if (!resource) continue;
      issues.push(
        ...resource.requirements.map((requirement) => `${resource.name}: ${requirement}`),
      );
      if (!resource.source.startsWith('builtin:'))
        issues.push(`${resource.name}: требуется реальная проверка ресурса.`);
    }
  return issues;
}
