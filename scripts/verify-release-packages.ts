/** Read-only release inputs; extraction stays in owned temporary staging and never runs a package. */
import { readFile, writeFile, mkdtemp, rm, realpath, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { verifyManifest } from '../src/main/updates/manifest.ts';
import { extractUpdate } from '../src/main/updates/extractUpdate.ts';
import { verifyApplication } from '../src/main/updates/verifyApplication.ts';
import { verifyInventory } from '../bundled/update-helper/inventory.mjs';
import { verifyWindowsIcon } from './windows-icon.mjs';
import { readZipText } from './audit/zipText.mjs';
import { verifyBundledNotices } from './audit/bundledNotices.ts';

if (process.platform !== 'darwin') throw Error('Mac publisher verification requires macOS.');
const flags = process.argv.slice(2);
if (flags.length > 1 || flags.some((flag) => flag !== '--with-windows'))
  throw Error(
    'Usage: verify-release-packages.ts [--with-windows] (existing archives only; never builds)',
  );
const withWindows = flags.includes('--with-windows');
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const key = JSON.parse(await readFile('src/main/updates/publicKey.json', 'utf8')).spki;
const manifests = [];
for (const target of ['darwin-arm64', ...(withWindows ? ['win32-x64'] : [])]) {
  const m = verifyManifest(await readFile(`dist/Pi-Studio-${version}-${target}.update.json`), key);
  if (m.version !== version) throw Error('Unexpected version');
  const hash = createHash('sha256');
  for await (const part of createReadStream(join('dist', m.archive.name))) hash.update(part);
  if (hash.digest('hex') !== m.archive.sha256) throw Error('ZIP hash mismatch');
  manifests.push(m);
}
// A platform may be requested after the Mac release. Preserve each actual source
// commit and compare every compiled payload byte instead of relabeling metadata.
const directory = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-verify-release-')));
try {
  const mac = manifests[0],
    win = manifests[1];
  const app = await extractUpdate(
    join('dist', mac.archive.name),
    join(directory, 'payload'),
    mac,
    new AbortController().signal,
  );
  await verifyApplication(app, await realpath(join(homedir(), 'Applications/Pi Studio.app')), mac);
  await verifyInventory(app, 'darwin');
  const resources = join(app, 'Contents/Resources/app');
  const pkg = JSON.parse(await readFile(join(resources, 'package.json'), 'utf8'));
  if (pkg.version !== version) throw Error('Packaged metadata mismatch');
  if (
    !(await readFile(join(resources, 'out/main/index.cjs'))).equals(
      await readFile('out/main/index.cjs'),
    )
  )
    throw Error('Packaged main does not match built main');
  const ownLicense = await readFile('LICENSE');
  if (!ownLicense.equals(await readFile(join(resources, 'licenses/Pi-Studio-LICENSE.txt'))))
    throw Error('Own license missing');
  for (const file of ['Electron-LICENSE.txt', 'Chromium-LICENSES.html'])
    if ((await readFile(join(resources, 'licenses', file))).length < 1000)
      throw Error('Electron notices missing');
  const notices = await readFile(join(resources, 'out/renderer/THIRD_PARTY_NOTICES.txt'));
  const packageManifest = await readFile(join(resources, 'out/renderer/third-party-packages.json'));
  const packages = verifyBundledNotices(notices, JSON.parse(packageManifest.toString('utf8')));
  const compiledFiles: string[] = [];
  async function compiled(directory: string, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) await compiled(join(directory, entry.name), name + '/');
      else if (entry.isFile()) compiledFiles.push(name);
      else throw Error('Unexpected non-file in compiled output: ' + name);
    }
  }
  await compiled('out');
  for (const name of compiledFiles) {
    if (!(await readFile(join(resources, 'out', name))).equals(await readFile(join('out', name))))
      throw Error('Mac compiled payload mismatch: ' + name);
  }
  if (win) {
    const windowsZip = join('dist', win.archive.name);
    execFileSync('/usr/bin/unzip', ['-tqq', windowsZip], { stdio: 'pipe', timeout: 120000 });
    const pe = await readZipText(windowsZip, 'Pi Studio/Pi Studio.exe', 512 * 1024 ** 2);
    if (!pe) throw Error('Missing Windows executable');
    verifyWindowsIcon(pe, await readFile('public/branding/pi-studio.ico'));
    const addonNotice = await readZipText(
      windowsZip,
      'Pi Studio/resources/app/licenses/Node-addon-api-MIT.txt',
    );
    if (
      !addonNotice ||
      !addonNotice.equals(await readFile('third-party-licenses/Node-addon-api-MIT.txt'))
    )
      throw Error('Missing Windows Node-addon-api notice');
    for (const name of [
      'package.json',
      'lib/index.js',
      'LICENSE',
      'build/Release/windows_process_tree.node',
    ]) {
      const bytes = await readZipText(
        windowsZip,
        'Pi Studio/resources/app/node_modules/@vscode/windows-process-tree/' + name,
      );
      if (
        !bytes ||
        !bytes.equals(await readFile('node_modules/@vscode/windows-process-tree/' + name))
      )
        throw Error('Windows native process probe payload mismatch: ' + name);
    }
    for (const [entry, expected] of [
      ['resources/app/out/main/index.cjs', await readFile('out/main/index.cjs')],
      ['resources/app/licenses/Pi-Studio-LICENSE.txt', ownLicense],
      ['resources/app/out/renderer/THIRD_PARTY_NOTICES.txt', notices],
      ['resources/app/out/renderer/third-party-packages.json', packageManifest],
    ] as const) {
      const bytes = await readZipText(windowsZip, 'Pi Studio/' + entry);
      if (!bytes || !Buffer.from(bytes).equals(expected))
        throw Error('Windows payload mismatch: ' + entry);
    }
    for (const name of compiledFiles) {
      const bytes = await readZipText(windowsZip, 'Pi Studio/resources/app/out/' + name);
      if (!bytes || !Buffer.from(bytes).equals(await readFile(join('out', name))))
        throw Error('Windows compiled payload mismatch: ' + name);
    }
  }
  const proof = {
    checkedAt: new Date().toISOString(),
    version,
    sourceCommit: mac.sourceCommit,
    sourceCommits: manifests.map(({ platform, sourceCommit }) => ({ platform, sourceCommit })),
    compiledPayloadFilesComparedOnEachPlatform: compiledFiles.length,
    assets: manifests.map((m) => ({ platform: m.platform, arch: m.arch, ...m.archive })),
    ed25519AndStreamedHashesVerified: true,
    macProductionExtractionAllCrcs: true,
    macDeepStrictSignaturePublisherIdArchitectureAndInventory: true,
    mainMatchesBuildOnAllVerifiedPlatforms: true,
    verifiedPlatforms: manifests.map((m) => m.platform),
    ownMitLicenseOnAllVerifiedPlatforms: true,
    rendererNoticePackages: packages.packages.length,
    windowsComparedOnlyWhenExplicitlyRequested: withWindows,
    macElectronAndChromiumNotices: true,
    windowsCrc: !!win,
    windowsBrandedIconVerifiedInActualPe: !!win,
    windowsNativeProcessProbePayloadVerified: !!win,
    installedApplicationOrUserDataMutated: false,
    programsExecuted: false,
    buildsCreated: 0,
    nativeWindowsAcceptance: false,
    notarized: false,
    temporaryStagingRemoved: true,
    scope:
      'Actual signed archives and payload verification only; not real GitHub update/native Windows/final rights acceptance.',
  };
  await writeFile(
    `artifacts/release-package-${version}-proof.json`,
    JSON.stringify(proof, null, 2) + '\n',
  );
  console.log(JSON.stringify(proof));
} finally {
  await rm(directory, { recursive: true, force: true });
}
