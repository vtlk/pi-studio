import { t } from '../../shared/i18n/index.ts';
import { access, realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { ProjectAgentProfile } from '../../shared/project.ts';
import type { Resource } from '../../shared/resources.ts';
import { inspectSkill } from '../storage/skills.ts';
import { nativeMcpConfig } from './nativeMcp.ts';
import { builtinResource, reservedMcpName } from '../../shared/builtinResources.ts';

export type McpConfigResolver = (
  resource: Resource,
  config: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export interface ResolvedResources {
  skills: { id: string; name: string; path: string }[];
  plugins: { id: string; source: string }[];
  mcpServers: {
    name: string;
    config: Record<string, unknown>;
    source: string;
    scope: 'extension';
  }[];
}
function args(value: string): string[] {
  if (!value.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(t('error.resources.mcpArgumentsMustBeA'));
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string'))
    throw new Error(t('error.resources.mcpArgumentsMustBeA'));
  return parsed;
}
/** Resolve only selected, enabled resources. Pi retains its native OAuth/token handling. */
export async function resolveResources(
  profile: ProjectAgentProfile,
  catalog: Resource[],
  materialize?: McpConfigResolver,
): Promise<ResolvedResources> {
  const result: ResolvedResources = { skills: [], plugins: [], mcpServers: [] };
  const names = new Set<string>();
  for (const kind of ['skills', 'mcps', 'plugins'] as const)
    for (const id of profile[kind]) {
      if (profile.capabilitySettings?.[`${kind}:${id}`]?.enabled === false) continue;
      if (kind === 'mcps' && builtinResource(id)) continue;
      const resource = catalog.find((item) => item.id === id && item.kind === kind);
      if (!resource)
        throw new Error(
          t('error.resources.assignedResourceIsMissingExplicitly', {
            value1: kind,
            value2: id,
          }),
        );
      if (kind === 'skills') {
        const skill = await inspectSkill(resource.source);
        if (names.has(skill.name))
          throw new Error(t('error.resources.duplicateSkillName', { value1: skill.name }));
        names.add(skill.name);
        result.skills.push({ id, name: skill.name, path: skill.source });
      } else if (kind === 'plugins') {
        let source = resource.source;
        if (isAbsolute(source)) {
          source = await realpath(source);
          await access(source);
        } else if (!/^(npm:|git:|https:\/\/github\.com\/)/.test(source))
          throw new Error(
            t('error.resources.packageAnExistingPathOr', {
              value1: resource.name,
            }),
          );
        result.plugins.push({ id, source });
      } else {
        const name = resource.source.startsWith('pi:')
          ? resource.source.slice(3)
          : `studio_${id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
        if (!/^[a-zA-Z0-9_-]+$/.test(name) || reservedMcpName(name))
          throw new Error(t('error.resources.invalidMcpName', { value1: resource.name }));
        let config: Record<string, unknown>;
        if (resource.source.startsWith('pi:')) {
          const server = await nativeMcpConfig(name);
          if (server.enabled === false)
            throw new Error(t('error.resources.mcpIsDisabledInPi', { value1: name }));
          config = { ...server };
        } else {
          if (resource.credential)
            throw new Error(
              t('error.resources.mcpConfigureTheSecretThrough', {
                value1: resource.name,
              }),
            );
          config = /^https?:\/\//.test(resource.source)
            ? { url: resource.source, exposure: 'direct' }
            : { command: resource.source, args: args(resource.args), exposure: 'direct' };
        }
        if (resource.credential === 'keychain:pistudio-mcp' && !materialize)
          throw new Error(t('error.resources.protectedMcpParametersAreUnavailable'));
        if (materialize) config = await materialize(resource, config);
        if (
          result.mcpServers.some(
            (item) => item.name.replaceAll('-', '_') === name.replaceAll('-', '_'),
          )
        )
          throw new Error(t('error.resources.duplicateMcpName', { value1: name }));
        result.mcpServers.push({
          name,
          config: { ...config, enabled: true },
          source: 'Pi Studio assignment',
          scope: 'extension',
        });
      }
    }
  return result;
}
