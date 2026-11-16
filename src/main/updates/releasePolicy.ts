import { t } from '../../shared/i18n/index.ts';
import semver from 'semver';
import type { UpdateManifest, UpdatePlatform } from '../../shared/updates.ts';

export interface UpdateTarget {
  version: string;
  platform: UpdatePlatform;
  arch: string;
  osVersion: string;
}
/** OS APIs may omit a patch number or include a Windows revision; metadata uses three parts. */
export function normalizeOsVersion(value: string) {
  if (!/^\d+(?:\.\d+){0,3}$/.test(value))
    throw new Error(t('error.releasePolicy.couldNotDetermineTheOperating'));
  const parts = value.split('.').map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part)))
    throw new Error(t('error.releasePolicy.invalidOperatingSystemVersion'));
  return [parts[0], parts[1] ?? 0, parts[2] ?? 0].join('.');
}
export function newerInChannel(current: string, candidate: string) {
  const from = semver.parse(current),
    to = semver.parse(candidate);
  if (!from || !to || !semver.gt(to, from)) return false;
  if (!to.prerelease.length) return true;
  // A prerelease opts into its own named channel, never another experimental channel.
  return (
    from.prerelease.length > 0 &&
    typeof from.prerelease[0] === 'string' &&
    from.prerelease[0] === to.prerelease[0]
  );
}
export function compatible(target: UpdateTarget, manifest: UpdateManifest) {
  return (
    newerInChannel(target.version, manifest.version) &&
    target.platform === manifest.platform &&
    target.arch === manifest.arch &&
    semver.valid(target.osVersion) !== null &&
    semver.gte(target.osVersion, manifest.minOs)
  );
}
