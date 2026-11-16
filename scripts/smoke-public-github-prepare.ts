/** Real published packages + production preparation/helper cancellation; no GUI or commit. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  statfs,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkGitHubReleases } from '../src/main/updates/githubReleases.ts';
import {
  boundedBody,
  githubResponse,
  releaseAssetUrl,
  type FetchUpdate,
} from '../src/main/updates/githubTransport.ts';
import { downloadVerifiedUpdate } from '../src/main/updates/download.ts';
import { maxManifestBytes, verifyManifest } from '../src/main/updates/manifest.ts';
import { extractUpdate } from '../src/main/updates/extractUpdate.ts';
import { applicationIdentity, verifyApplication } from '../src/main/updates/verifyApplication.ts';
import { NativeUpdateInstaller } from '../src/main/updates/NativeUpdateInstaller.ts';
import type { PreparedInstallation } from '../src/main/updates/installation.ts';
import { normalizeOsVersion } from '../src/main/updates/releasePolicy.ts';
import { verifyInventory } from '../bundled/update-helper/inventory.mjs';

assert.equal(process.platform, 'darwin');
assert.equal(process.arch, 'arm64');
const previous = '0.2.0-alpha.84';
const current = JSON.parse(await readFile('package.json', 'utf8')).version;
const { spki } = JSON.parse(await readFile('src/main/updates/publicKey.json', 'utf8'));
const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-public-prepare-')));
const signal = AbortSignal.timeout(10 * 60_000);
const requests: { host: string; path: string; status: number }[] = [];
const anonymous: FetchUpdate = async (input, options) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const headers = new Headers(options?.headers);
  assert.equal(headers.has('authorization'), false);
  assert.equal(headers.has('cookie'), false);
  assert.equal(options?.credentials, 'omit');
  const response = await fetch(input, options);
  requests.push({ host: url.hostname, path: url.pathname, status: response.status });
  return response;
};
const osVersion = normalizeOsVersion(
  execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim(),
);
let prepared: PreparedInstallation | undefined;
let proof: Record<string, unknown> | undefined;
try {
  assert.ok((await statfs(root).then((value) => value.bavail * value.bsize)) >= 2 * 1024 ** 3);
  const oldMetadata = releaseAssetUrl(
    'v' + previous,
    `Pi-Studio-${previous}-darwin-arm64.update.json`,
  );
  const oldManifest = verifyManifest(
    await boundedBody(await githubResponse(oldMetadata, signal, anonymous), maxManifestBytes),
    spki,
  );
  assert.equal(oldManifest.version, previous);
  const update = await checkGitHubReleases({
    target: { version: previous, platform: 'darwin', arch: 'arm64', osVersion },
    publicKey: spki,
    signal,
    fetch: anonymous,
  });
  assert.ok(update);
  assert.equal(update.manifest.version, current);
  const oldArchive = join(root, oldManifest.archive.name);
  const archive = join(root, update.manifest.archive.name);
  const progress = (label: string) => {
    let reported = 0;
    return (bytes: number) => {
      if (bytes - reported >= 32 * 1024 ** 2) {
        console.log(`${label}: ${Math.round(bytes / 1024 ** 2)} MiB`);
        reported = bytes;
      }
    };
  };
  await downloadVerifiedUpdate({
    update: {
      ...update,
      manifest: oldManifest,
      manifestUrl: oldMetadata,
      archiveUrl: releaseAssetUrl('v' + previous, oldManifest.archive.name),
    },
    publicKey: spki,
    destination: oldArchive,
    signal,
    fetch: anonymous,
    progress: progress(previous),
  });
  await downloadVerifiedUpdate({
    update,
    publicKey: spki,
    destination: archive,
    signal,
    fetch: anonymous,
    progress: progress(current),
  });
  const target = await extractUpdate(oldArchive, join(root, 'installed'), oldManifest, signal);
  await verifyApplication(target, target, oldManifest);
  await verifyInventory(target, 'darwin');
  const identity = await applicationIdentity(target);
  const userData = join(root, 'userData');
  const studio = join(root, 'studio');
  await mkdir(userData);
  await mkdir(studio);
  const fixture = new Map([
    [join(userData, 'workspace.json'), Buffer.from(JSON.stringify({ folder: studio }))],
    [join(userData, 'protected-dummy.bin'), randomBytes(48)],
    [join(studio, 'result.md'), Buffer.from('# Preserved isolated QA result\n')],
    [join(studio, 'session.jsonl'), Buffer.from('{"type":"session","id":"qa"}\n')],
  ]);
  for (const [file, bytes] of fixture) await writeFile(file, bytes, { mode: 0o600 });
  const installer = new NativeUpdateInstaller({
    target,
    userData,
    version: previous,
    platform: 'darwin',
    arch: 'arm64',
    helperSource: join(target, 'Contents/Resources/app/bundled/update-helper'),
    protectedRoots: () => [studio],
    helperNode: async () => realpath(process.execPath),
  });
  prepared = await installer.prepare(archive, update.manifest, signal);
  // Start the real published helper, but never grant replacement permission.
  // It must acknowledge cancellation while this oldPid is still alive.
  await prepared.arm();
  await prepared.dispose();
  prepared = undefined;
  assert.deepEqual(await applicationIdentity(target), identity);
  await verifyInventory(target, 'darwin');
  await verifyApplication(target, target, oldManifest);
  for (const [file, bytes] of fixture) assert.deepEqual(await readFile(file), bytes);
  assert.equal(
    (await readdir(join(root, 'installed'))).some((name) => name.startsWith('.pistudio-update-')),
    false,
  );
  assert.equal((await readdir(join(userData, 'updates/transactions'))).length, 0);
  await assert.rejects(readFile(join(userData, 'updates/active.json')), { code: 'ENOENT' });
  proof = {
    checkedAt: new Date().toISOString(),
    actualAnonymousGithub: true,
    from: previous,
    to: current,
    archives: [oldManifest, update.manifest].map((manifest) => ({
      version: manifest.version,
      sourceCommit: manifest.sourceCommit,
      ...manifest.archive,
    })),
    productionEd25519AndArchiveHashes: true,
    unmodifiedPublishedApplications: true,
    realInstallerPreparation: true,
    realPublishedHelperArmedAndCancelled: true,
    commitCalled: false,
    temporaryOldApplicationIdentityAndInventoryPreserved: true,
    protectedFixtureFilesPreserved: fixture.size,
    transactionAndActiveMarkerRemoved: true,
    installedApplicationOrUserDataAccessed: false,
    guiOrPersonalBrowserLaunched: false,
    signingIdentityOrKeychainAccessed: false,
    requests,
    limitations:
      'Actual download/prepare/arm/cancel only. No directory replacement, app relaunch or full GitHub-driven UI acceptance; those still require an authorized visible cycle.',
  };
} finally {
  // A failed dispose must not be followed by deleting an unconfirmed live helper's files.
  if (prepared) await prepared.dispose();
  await rm(root, { recursive: true, force: true });
}
assert.ok(proof);
proof.temporaryPackagesAndApplicationsRemoved = true;
await mkdir('artifacts', { recursive: true });
await writeFile(
  'artifacts/public-github-prepare-proof.json',
  JSON.stringify(proof, null, 2) + '\n',
);
console.log(
  JSON.stringify({ from: previous, to: current, preparedAndCancelled: true, cleaned: true }),
);
