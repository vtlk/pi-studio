import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import type {
  TeamPackage,
  TeamPackageFile,
  TeamPackageManifest,
} from '../../shared/teamPackage.ts';
import { parseAgents, record, stableId } from '../storage/validation.ts';
import { packageSource, assertCredentialReferences } from '../pi/resourceConfig.ts';
import { assertPortableMcp } from './portableMcp.ts';
import { parseModelEndpoint } from '../../shared/modelEndpoint.ts';

export const packageLimit = 64 * 1024 * 1024;
export const fileDigest = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
export function packagePath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 1500 ||
    !/^resources\/resource-[0-9]+\/files\//.test(value) ||
    value.split('/').some((part) => !part || part === '.' || part === '..') ||
    value.includes('\\') ||
    [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    throw new Error('Недопустимый путь в пакете команды.');
  return value;
}
function shortText(value: unknown, max = 4000): string {
  if (typeof value !== 'string' || value.length > max)
    throw new Error('Некорректное поле пакета команды.');
  return value;
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 10000) throw new Error('Некорректный список пакета.');
  return value.map((value) => shortText(value));
}
export function validatePackage(value: unknown): TeamPackage {
  const doc = record(value),
    m = record(doc.manifest);
  if (m.format !== 'pi-studio-team' || m.version !== 1)
    throw new Error('Неподдерживаемая версия пакета команды.');
  const team = record(m.team),
    name = shortText(team.name, 500).trim();
  if (!name) throw new Error('В пакете отсутствует название команды.');
  if (
    !Array.isArray(m.resources) ||
    m.resources.length > 1000 ||
    !Array.isArray(m.connections) ||
    m.connections.length > 1000
  )
    throw new Error('Слишком большой каталог пакета.');
  const resources = m.resources.map((value) => {
    const r = record(value),
      id = stableId(r.id);
    if (!/^resource-[0-9]+$/.test(id) || !['skills', 'mcps', 'plugins'].includes(String(r.kind)))
      throw new Error('Некорректный ресурс пакета.');
    const source = shortText(r.source);
    if (
      source &&
      !source.startsWith('builtin:') &&
      !source.startsWith('npm:') &&
      !source.startsWith('git:') &&
      !source.startsWith('https://') &&
      !source.startsWith('http://') &&
      !source.startsWith('command:') &&
      source !== 'local'
    )
      throw new Error('Непереносимый источник ресурса пакета.');
    if (r.mcp !== undefined) assertPortableMcp(record(r.mcp));
    if (/^https?:/.test(source)) assertCredentialReferences({ url: source });
    if (r.kind === 'plugins' && source !== 'local') packageSource(source);
    let filesRoot: string | undefined;
    if (r.filesRoot !== undefined) {
      filesRoot = shortText(r.filesRoot);
      if (filesRoot !== `resources/${id}/files`)
        throw new Error('Некорректная область файлов ресурса.');
    }
    return {
      id,
      name: shortText(r.name, 500),
      kind: r.kind as 'skills' | 'mcps' | 'plugins',
      description: shortText(r.description, 200000),
      version: shortText(r.version, 500),
      source,
      ...(filesRoot ? { filesRoot } : {}),
      ...(r.mcp === undefined ? {} : { mcp: record(r.mcp) }),
      requirements: strings(r.requirements),
    };
  });
  const connections = m.connections.map((value) => {
    const c = record(value),
      id = stableId(c.id);
    const endpoint = c.endpoint === undefined ? undefined : shortText(c.endpoint);
    if (endpoint) assertCredentialReferences({ url: endpoint });
    return {
      id,
      name: shortText(c.name, 500),
      provider: shortText(c.provider, 500),
      purpose: shortText(c.purpose, 100),
      ...(endpoint ? { endpoint } : {}),
      ...(c.endpointConfig === undefined
        ? {}
        : { endpointConfig: parseModelEndpoint(c.endpointConfig) }),
    };
  });
  const agents = parseAgents(m.agents);
  const ids = new Set(resources.map((r) => r.id));
  if (
    ids.size !== resources.length ||
    new Set(connections.map((c) => c.id)).size !== connections.length
  )
    throw new Error('Повторяющиеся ссылки пакета.');
  for (const agent of agents) {
    for (const kind of ['skills', 'mcps', 'plugins'] as const)
      for (const id of agent[kind]) {
        if (!resources.some((r) => r.id === id && r.kind === kind))
          throw new Error('Назначение ссылается на отсутствующий ресурс.');
      }
    if (agent.model?.connectionId && !connections.some((c) => c.id === agent.model!.connectionId))
      throw new Error('Отсутствует требование модельного подключения.');
  }
  if (!Array.isArray(doc.files) || doc.files.length > 10000)
    throw new Error('Слишком много файлов пакета.');
  let bytes = 0;
  const files: TeamPackageFile[] = doc.files.map((value) => {
    const f = record(value),
      path = packagePath(f.path),
      data = shortText(f.data, packageLimit * 2);
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data))
      throw new Error('Некорректные двоичные данные пакета.');
    const buffer = Buffer.from(data, 'base64');
    bytes += buffer.length;
    if (
      bytes > packageLimit ||
      fileDigest(buffer) !== f.sha256 ||
      typeof f.executable !== 'boolean'
    )
      throw new Error('Нарушена целостность или размер пакета.');
    if (!resources.some((r) => r.filesRoot && path.startsWith(r.filesRoot + '/')))
      throw new Error('Файл не принадлежит ресурсу пакета.');
    return { path, data, sha256: f.sha256 as string, executable: f.executable };
  });
  const fileNames = files.map((file) => file.path.toLowerCase());
  if (new Set(fileNames).size !== files.length)
    throw new Error('Повторяющиеся пути файлов пакета.');
  for (const r of resources)
    if (
      r.kind === 'skills' &&
      r.filesRoot &&
      !files.some((f) => f.path === r.filesRoot + '/SKILL.md')
    )
      throw new Error('В пакете отсутствует SKILL.md.');
  const manifest: TeamPackageManifest = {
    format: 'pi-studio-team',
    version: 1,
    team: { name },
    agents,
    resources,
    connections,
    requirements: strings(m.requirements),
  };
  return { manifest, files };
}
export function encodePackage(value: TeamPackage) {
  const json = Buffer.from(JSON.stringify(validatePackage(value)));
  if (json.length > packageLimit * 2) throw new Error('Пакет команды превышает допустимый размер.');
  const encoded = gzipSync(json);
  if (encoded.length > packageLimit) throw new Error('Архив команды превышает 64 МБ.');
  return encoded;
}
export function decodePackage(bytes: Uint8Array) {
  if (bytes.length > packageLimit) throw new Error('Пакет превышает 64 МБ.');
  try {
    return validatePackage(
      JSON.parse(gunzipSync(bytes, { maxOutputLength: packageLimit * 2 }).toString('utf8')),
    );
  } catch (error) {
    throw new Error(
      `Пакет команды не принят: ${error instanceof Error ? error.message : 'повреждённый архив'}`,
      { cause: error },
    );
  }
}
