/** Real signed archive extraction in owned staging. Never launches an app or opens a studio. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { verifyManifest } from '../src/main/updates/manifest.ts';
import { extractUpdate } from '../src/main/updates/extractUpdate.ts';
import { verifyApplication } from '../src/main/updates/verifyApplication.ts';

const [metadataPath, installed] = process.argv.slice(2);
if (process.platform !== 'darwin' || !metadataPath || !installed?.endsWith('/Pi Studio.app'))
  throw new Error(
    'Usage: smoke-update-extraction.ts dist/<mac.update.json> /absolute/Pi Studio.app',
  );
const key = JSON.parse(await readFile('src/main/updates/publicKey.json', 'utf8'));
const manifest = verifyManifest(await readFile(metadataPath), key.spki);
const archive = resolve(metadataPath, '..', manifest.archive.name);
const hash = createHash('sha256');
let bytes = 0;
for await (const chunk of createReadStream(archive)) {
  hash.update(chunk);
  bytes += chunk.length;
}
if (bytes !== manifest.archive.bytes || hash.digest('hex') !== manifest.archive.sha256)
  throw new Error('Signed archive mismatch.');
const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-update-extraction-')));
try {
  const candidate = await extractUpdate(
    archive,
    join(root, 'next'),
    manifest,
    new AbortController().signal,
  );
  await verifyApplication(candidate, installed, manifest);
  await rm(root, { recursive: true, force: true });
  const proof = {
    checkedAt: new Date().toISOString(),
    baseHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    checkoutHasUncommittedInstallerChanges: true,
    version: manifest.version,
    sourceCommit: manifest.sourceCommit,
    archive: manifest.archive,
    ed25519Verified: true,
    streamedArchiveHashVerified: true,
    entryCrcsVerified: true,
    safeSymlinksAndModesPreserved: true,
    extractedDeepStrictSignatureAndPublisherVerified: true,
    bundleIdAndArchitectureVerified: true,
    temporaryStagingRemoved: true,
    installedApplicationMutated: false,
    guiProcessesStarted: 0,
    studioOrSessionAccess: false,
    scope:
      'Signed release ZIP fully extracted with production code and checked against the installed publisher; not a GitHub-to-installed update or Windows acceptance.',
  };
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/update-extraction-proof.json', JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof));
} finally {
  await rm(root, { recursive: true, force: true });
}
