import { t } from '../../shared/i18n/index.ts';
import semver from 'semver';
import type { UpdateManifest, UpdateOffer } from '../../shared/updates.ts';
import { manifestName, maxManifestBytes, verifyManifest } from './manifest.ts';
import { compatible, newerInChannel, type UpdateTarget } from './releasePolicy.ts';
import {
  boundedBody,
  githubResponse,
  releaseApi,
  releaseAssetUrl,
  type FetchUpdate,
} from './githubTransport.ts';

interface ReleaseAsset {
  name: string;
  size: number;
  digest?: string;
}
interface Release {
  tag_name: string;
  body?: string;
  assets: ReleaseAsset[];
}
export interface VerifiedUpdate {
  manifest: UpdateManifest;
  offer: UpdateOffer;
  archiveUrl: string;
  manifestUrl: string;
}
function release(value: unknown, target: UpdateTarget): value is Release {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  const version =
    typeof data.tag_name === 'string' && data.tag_name.startsWith('v')
      ? data.tag_name.slice(1)
      : '';
  if (
    data.draft !== false ||
    semver.valid(version) !== version ||
    !newerInChannel(target.version, version) ||
    Boolean(data.prerelease) !== Boolean(semver.prerelease(version)?.length) ||
    !Array.isArray(data.assets)
  )
    return false;
  return data.assets.every(
    (item: unknown) =>
      !!item &&
      typeof item === 'object' &&
      typeof (item as ReleaseAsset).name === 'string' &&
      Number.isSafeInteger((item as ReleaseAsset).size),
  );
}
function uniqueAsset(item: Release, name: string) {
  const matches = item.assets.filter((asset) => asset.name === name);
  if (matches.length > 1)
    throw new Error(t('error.githubReleases.githubReturnedAmbiguousUpdateFiles'));
  return matches[0];
}
export async function checkGitHubReleases(options: {
  target: UpdateTarget;
  publicKey: string;
  signal: AbortSignal;
  fetch?: FetchUpdate;
}): Promise<VerifiedUpdate | undefined> {
  const releases: Release[] = [];
  for (let page = 1; page <= 10; page++) {
    const response = await githubResponse(
      `${releaseApi}?per_page=100&page=${page}`,
      options.signal,
      options.fetch,
    );
    const data: unknown = JSON.parse(
      (await boundedBody(response, 4 * 1024 ** 2, options.signal)).toString('utf8'),
    );
    if (!Array.isArray(data))
      throw new Error(t('error.githubReleases.githubReturnedAnInvalidRelease'));
    releases.push(...data.filter((item) => release(item, options.target)));
    if (data.length < 100) break;
    if (page === 10) throw new Error(t('error.githubReleases.theReleaseListIsToo'));
  }
  releases.sort((a, b) => semver.rcompare(a.tag_name.slice(1), b.tag_name.slice(1)));
  for (const item of releases) {
    const version = item.tag_name.slice(1);
    const name = manifestName(version, options.target.platform, options.target.arch);
    const metadata = uniqueAsset(item, name);
    if (!metadata) continue; // Old ZIP-only releases are not eligible for automatic installation.
    if (metadata.size < 1 || metadata.size > maxManifestBytes)
      throw new Error(t('error.githubReleases.invalidUpdateMetadataSize'));
    const manifestUrl = releaseAssetUrl(item.tag_name, name);
    const response = await githubResponse(manifestUrl, options.signal, options.fetch);
    const bytes = await boundedBody(response, maxManifestBytes, options.signal);
    if (bytes.length !== metadata.size)
      throw new Error(t('error.githubReleases.updateMetadataChangedWhileBeing'));
    const manifest = verifyManifest(bytes, options.publicKey);
    if (manifest.version !== version)
      throw new Error(t('error.githubReleases.theSignedPackageVersionDoes'));
    if (!compatible(options.target, manifest)) continue;
    const archive = uniqueAsset(item, manifest.archive.name);
    if (!archive) continue;
    if (
      archive.size !== manifest.archive.bytes ||
      (archive.digest !== undefined && archive.digest !== `sha256:${manifest.archive.sha256}`)
    )
      throw new Error(t('error.githubReleases.theGithubFileDoesNot'));
    return {
      manifest,
      manifestUrl,
      archiveUrl: releaseAssetUrl(item.tag_name, archive.name),
      offer: {
        version,
        bytes: archive.size,
        notes: typeof item.body === 'string' ? item.body.slice(0, 16_000) : '',
        releaseUrl: `https://github.com/vtlk/pi-studio/releases/tag/${encodeURIComponent(item.tag_name)}`,
      },
    };
  }
}
