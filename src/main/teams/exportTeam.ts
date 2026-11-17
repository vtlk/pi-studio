import { normalizeBuiltinAssignments } from '../../shared/builtinAssignments.ts';
import { t } from '../../shared/i18n/index.ts';
import { isAbsolute } from 'node:path';
import type { AgentCatalog } from '../../shared/agentTeams.ts';
import { teamAgents } from '../../shared/agentTeams.ts';
import type { Connection } from '../../shared/connections.ts';
import type { Resource } from '../../shared/resources.ts';
import type {
  TeamPackage,
  PortableResource,
  PortableConnection,
} from '../../shared/teamPackage.ts';
import { builtinResource } from '../../shared/builtinResources.ts';
import { nativeMcpConfig } from '../pi/nativeMcp.ts';
import { inspectSkill } from '../storage/skills.ts';
import { collectPackageFiles } from './collectPackageFiles.ts';
import { portableMcp } from './portableMcp.ts';
import { validatePackage } from './packageCodec.ts';
import { describeMcpAuthorization } from '../../shared/mcpAuthorization.ts';

export async function exportTeam(
  catalog: AgentCatalog,
  teamId: string,
  resources: Resource[],
  connections: Connection[],
  readMcp = nativeMcpConfig,
  imageTool?: { connectionId?: string; modelId?: string },
): Promise<TeamPackage> {
  const profiles = structuredClone(teamAgents(catalog, teamId)).map(normalizeBuiltinAssignments),
    team = catalog.teams.find((team) => team.id === teamId)!;
  const resourceMap = new Map<string, string>(),
    connectionMap = new Map<string, string>();
  const portable: PortableResource[] = [],
    accounts: PortableConnection[] = [],
    files: TeamPackage['files'] = [];
  const requirements = [
    'Требуется Pi Studio с встроенными Project/Browser/Computer MCP. Runtime/provider расширения Pi не копируются глобально: проверьте поддержку каждого указанного провайдера.',
  ];
  if (profiles.some((agent) => agent.model?.provider === 'claude-code'))
    requirements.push(
      'Claude Code: требуется встроенный провайдер Pi Studio @earendil-works/pi-claude-code 0.1.0 (d5b5e04c314d3452d357174d16d10dda34daa2d2), совместимый официальный Claude CLI 2.1+ (2.x) и явный общий подписочный вход. CLI, его авторизация и история не переносятся; сопоставление подключения выполняется явно, без API/extra usage fallback.',
    );
  for (const agent of profiles) {
    const settings: NonNullable<typeof agent.capabilitySettings> = {};
    for (const kind of ['skills', 'mcps', 'plugins'] as const) {
      const assigned: string[] = [];
      for (const id of agent[kind]) {
        let ref = resourceMap.get(id);
        if (!ref) {
          const resource =
            resources.find((resource) => resource.id === id && resource.kind === kind) ??
            builtinResource(id);
          if (!resource || resource.kind !== kind)
            throw new Error(
              t('error.exportTeam.resourceForAgentIsMissing', {
                value1: id,
                value2: agent.name,
              }),
            );
          ref = `resource-${portable.length + 1}`;
          const r: PortableResource = {
            id: ref,
            name: resource.name,
            kind,
            description: resource.description,
            version: resource.version,
            source: 'local',
            requirements: [],
          };
          if (resource.source.startsWith('builtin:')) {
            r.source = resource.source;
            if (kind === 'mcps') r.authorization = { required: 'no', methods: [], fields: [] };
          } else if (kind === 'skills' || (kind === 'plugins' && isAbsolute(resource.source))) {
            const source =
              kind === 'skills' ? (await inspectSkill(resource.source)).source : resource.source;
            r.filesRoot = `resources/${ref}/files`;
            const collected = await collectPackageFiles(source, r.filesRoot);
            files.push(...collected.files);
            r.requirements.push(...collected.requirements);
            if (kind === 'plugins')
              r.requirements.push(
                'Установить локальные зависимости пакета штатным Pi после проверки источника.',
              );
          } else if (kind === 'plugins') {
            r.source = resource.source;
            const npm = /^npm:((?:@[^/]+\/)?[^@]+)(?:@.+)?$/.exec(resource.source);
            if (npm && /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(resource.version))
              r.source = `npm:${npm[1]}@${resource.version}`;
            r.requirements.push(
              `Установить Pi-пакет ${r.source}, требуемая версия ${resource.version || 'не указана отправителем; необходимо явное уточнение'}.`,
            );
          } else {
            const raw: Record<string, unknown> = resource.source.startsWith('pi:')
              ? await readMcp(resource.source.slice(3))
              : /^https?:/.test(resource.source)
                ? { url: resource.source }
                : { command: resource.source, args: JSON.parse(resource.args || '[]') };
            const described = portableMcp(raw);
            r.mcp = described.config;
            r.authorization = describeMcpAuthorization(raw, resource.check);
            r.requirements.push(...described.requirements);
            r.source =
              typeof raw.url === 'string'
                ? raw.url
                : `command:${typeof raw.command === 'string' ? raw.command : 'native'}`;
            r.requirements.push(
              'Проверить MCP через native Pi; авторизация и локальные зависимости не переносятся.',
            );
          }
          portable.push(r);
          resourceMap.set(id, ref);
        }
        assigned.push(ref);
        if (agent.capabilitySettings?.[`${kind}:${id}`])
          settings[`${kind}:${ref}`] = agent.capabilitySettings[`${kind}:${id}`];
      }
      agent[kind] = assigned;
    }
    agent.capabilitySettings = settings;
    if (agent.model?.connectionId) {
      const originalId = agent.model.connectionId;
      let ref = connectionMap.get(originalId);
      if (!ref) {
        const connection = connections.find((connection) => connection.id === originalId);
        ref = `connection-${accounts.length + 1}`;
        accounts.push({
          id: ref,
          name: connection?.name ?? 'Требуемое подключение',
          provider: agent.model.provider,
          purpose: connection?.purpose ?? 'pi',
          ...(connection?.endpoint ? { endpoint: connection.endpoint } : {}),
          ...(connection?.endpointConfig ? { endpointConfig: connection.endpointConfig } : {}),
        });
        connectionMap.set(originalId, ref);
      }
      agent.model.connectionId = ref;
    }
  }
  return validatePackage({
    manifest: {
      format: 'pi-studio-team',
      version: 1,
      team: { name: team.name, workspaceMode: team.workspaceMode },
      agents: profiles,
      resources: portable,
      connections: accounts,
      ...(imageTool?.connectionId &&
      imageTool.modelId &&
      profiles.some(
        (agent) =>
          agent.enabled &&
          agent.plugins.every(
            (id) => agent.capabilitySettings?.[`plugins:${id}`]?.enabled === false,
          ),
      )
        ? { tools: { images: true } }
        : {}),
      requirements,
    },
    files,
  });
}
