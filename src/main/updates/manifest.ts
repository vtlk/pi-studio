import { createPublicKey, verify } from 'node:crypto';
import semver from 'semver';
import type { UpdateManifest, UpdatePlatform } from '../../shared/updates.ts';

export const maxArchiveBytes = 1024 ** 3;
export const maxUnpackedBytes = 4 * 1024 ** 3;
export const maxManifestBytes = 32 * 1024;
export function archiveName(version: string, platform: UpdatePlatform, arch: string) {
  return `Pi-Studio-${version}-${platform === 'darwin' ? 'mac' : 'win'}-${arch}.zip`;
}
export function manifestName(version: string, platform: UpdatePlatform, arch: string) {
  return `Pi-Studio-${version}-${platform}-${arch}.update.json`;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Неверный формат метаданных обновления.');
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).sort().join() !== keys.sort().join())
    throw new Error('Неизвестные или отсутствующие поля обновления.');
}
export function validateManifest(value: unknown): UpdateManifest {
  const data = record(value);
  exactKeys(data, [
    'schema',
    'appId',
    'version',
    'platform',
    'arch',
    'minOs',
    'format',
    'sourceCommit',
    'archive',
  ]);
  if (
    data.schema !== 1 ||
    data.appId !== 'studio.pi.desktop' ||
    typeof data.version !== 'string' ||
    data.version.length > 80 ||
    semver.valid(data.version) !== data.version ||
    data.version.includes('+') ||
    !['darwin', 'win32'].includes(String(data.platform)) ||
    !['arm64', 'x64'].includes(String(data.arch)) ||
    (data.platform === 'win32' && data.arch !== 'x64') ||
    typeof data.minOs !== 'string' ||
    !/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(data.minOs) ||
    data.format !== (data.platform === 'darwin' ? 'mac-zip' : 'windows-portable-zip') ||
    typeof data.sourceCommit !== 'string' ||
    !/^[a-f0-9]{40}$/.test(data.sourceCommit)
  )
    throw new Error('Версия, платформа или формат обновления не поддерживаются.');
  const archive = record(data.archive);
  exactKeys(archive, ['name', 'sha256', 'bytes', 'unpackedBytes']);
  if (
    archive.name !==
      archiveName(data.version, data.platform as UpdatePlatform, String(data.arch)) ||
    typeof archive.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(archive.sha256) ||
    !Number.isSafeInteger(archive.bytes) ||
    Number(archive.bytes) < 1 ||
    Number(archive.bytes) > maxArchiveBytes ||
    !Number.isSafeInteger(archive.unpackedBytes) ||
    Number(archive.unpackedBytes) < 1 ||
    Number(archive.unpackedBytes) > maxUnpackedBytes
  )
    throw new Error('Пакет обновления имеет недопустимые имя, размер или контрольную сумму.');
  return structuredClone(data) as unknown as UpdateManifest;
}
function base64(value: unknown, limit: number) {
  if (typeof value !== 'string' || value.length > limit || !/^[A-Za-z0-9+/]+={0,2}$/.test(value))
    throw new Error('Неверный формат подписи обновления.');
  const result = Buffer.from(value, 'base64');
  if (result.toString('base64') !== value) throw new Error('Неверная кодировка подписи.');
  return result;
}
/** Verify the original bytes before parsing any trusted installation metadata. */
export function verifyManifest(envelope: Uint8Array, publicKey: string): UpdateManifest {
  if (envelope.byteLength > maxManifestBytes)
    throw new Error('Метаданные обновления слишком велики.');
  const data = record(JSON.parse(Buffer.from(envelope).toString('utf8')));
  exactKeys(data, ['payload', 'signature']);
  const payload = base64(data.payload, 24 * 1024);
  const signature = base64(data.signature, 88);
  const key = createPublicKey(publicKey);
  if (
    key.asymmetricKeyType !== 'ed25519' ||
    signature.length !== 64 ||
    !verify(null, payload, key, signature)
  )
    throw new Error('Подпись обновления не подтверждена. Пакет не будет установлен.');
  return validateManifest(JSON.parse(payload.toString('utf8')));
}
