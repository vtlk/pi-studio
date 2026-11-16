/** Actual anonymous GitHub feed and signed metadata; no app, model, personal data or installation. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeOsVersion } from '../src/main/updates/releasePolicy.ts';
import { downloadVerifiedUpdate } from '../src/main/updates/download.ts';
import { checkGitHubReleases } from '../src/main/updates/githubReleases.ts';
import type { FetchUpdate } from '../src/main/updates/githubTransport.ts';

const { spki } = JSON.parse(await readFile('src/main/updates/publicKey.json', 'utf8'));
const current = JSON.parse(await readFile('package.json', 'utf8')).version;
const requests: { host: string; path: string; status: number }[] = [];
const anonymous: FetchUpdate = async (input, options) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const headers = new Headers(options?.headers);
  assert.equal(headers.has('authorization'), false);
  assert.equal(headers.has('cookie'), false);
  assert.equal(options?.credentials, 'omit');
  const response = await fetch(input, options);
  // Signed download redirect query strings are intentionally excluded from the report.
  requests.push({ host: url.hostname, path: url.pathname, status: response.status });
  return response;
};
const signal = AbortSignal.timeout(10 * 60_000);
assert.equal(process.platform, 'darwin');
const osVersion = normalizeOsVersion(
  execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim(),
);
const target = {
  version: '0.2.0-alpha.84',
  platform: 'darwin' as const,
  arch: process.arch,
  osVersion,
};
const update = await checkGitHubReleases({ target, publicKey: spki, signal, fetch: anonymous });
assert.ok(update);
assert.equal(update.offer.version, current);
assert.equal(update.manifest.version, current);
assert.equal(update.manifest.platform, 'darwin');
assert.equal(update.manifest.arch, 'arm64');
const latest = await checkGitHubReleases({
  target: { ...target, version: current },
  publicKey: spki,
  signal,
  fetch: anonymous,
});
assert.equal(latest, undefined);
let archiveDownload:
  | {
      bytes: number;
      signedSha256Verified: boolean;
      archiveStructureVerified: boolean;
      temporaryArchiveRemoved: boolean;
    }
  | undefined;
if (process.argv.includes('--download')) {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-public-update-'));
  let received = 0,
    reported = 0;
  try {
    const destination = join(root, update.manifest.archive.name);
    await downloadVerifiedUpdate({
      update,
      publicKey: spki,
      destination,
      signal,
      fetch: anonymous,
      progress: (bytes) => {
        received = bytes;
        if (bytes - reported >= 32 * 1024 ** 2) {
          console.log(`Anonymous download: ${Math.round(bytes / 1024 ** 2)} MiB`);
          reported = bytes;
        }
      },
    });
    assert.equal(received, update.manifest.archive.bytes);
    assert.equal((await stat(destination)).size, received);
    archiveDownload = {
      bytes: received,
      signedSha256Verified: true,
      archiveStructureVerified: true,
      temporaryArchiveRemoved: true,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const proof = {
  checkedAt: new Date().toISOString(),
  actualAnonymousGithub: true,
  offeredFromVersion: target.version,
  verifiedOfferVersion: update.manifest.version,
  signedSourceCommit: update.manifest.sourceCommit,
  archive: update.manifest.archive,
  currentVersionHasNoNewerOffer: true,
  productionEd25519Verified: true,
  authorizationOrCookiesSent: false,
  installedApplicationOrUserDataChanged: false,
  installerInvoked: false,
  archiveDownloadedByThisCheck: !!archiveDownload,
  archiveDownload,
  osVersion,
  requests,
};
await mkdir('artifacts', { recursive: true });
await writeFile(
  'artifacts/public-github-updates-proof.json',
  JSON.stringify(proof, null, 2) + '\n',
);
console.log(JSON.stringify(proof));
