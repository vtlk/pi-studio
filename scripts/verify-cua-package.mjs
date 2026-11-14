import assert from 'node:assert/strict';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const bundle = resolve(process.argv[2]);
const root = resolve(import.meta.dirname, '..');
const application = join(bundle, 'Contents/Resources/app');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const metadata = JSON.parse(await readFile(join(application, 'package.json'), 'utf8'));
const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
assert.equal(metadata.version, JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version);
async function equalTree(from, to) {
  const names = await readdir(from);
  assert.deepEqual((await readdir(to)).sort(), names.sort());
  for (const name of names) {
    if ((await stat(join(from, name))).isDirectory()) await equalTree(join(from, name), join(to, name));
    else assert.equal(hash(await readFile(join(from, name))), hash(await readFile(join(to, name))), name);
  }
}
await equalTree(join(root, 'out'), join(application, 'out'));
await equalTree(join(root, 'bundled/pi-bridge'), join(application, 'bundled/pi-bridge'));
for (const name of ['@trycua/cua-driver', '@ubjs/core', '@ubjs/node'])
  await equalTree(join(root, 'node_modules', name), join(application, 'node_modules', name));
const native = join(application, 'node_modules', `@trycua/cua-driver-darwin-${process.arch}`);
assert.equal(JSON.parse(await readFile(join(native, 'package.json'), 'utf8')).version, '0.49.11');
for (const name of ['Cua-MIT.txt', 'MPL-2.0.txt', 'Cua-SOURCES.md'])
  assert.equal(hash(await readFile(join(application, 'licenses', name))), hash(await readFile(join(root, 'third-party-licenses', name))));
assert.equal(hash(await readFile(join(application, 'licenses/Cua-node-runtime-NOTICE.md'))), hash(await readFile(join(native, 'node-runtime-NOTICE.md'))));
for (const path of [bundle, ...['libcua_driver_sdk.dylib', 'cua_driver_node_runtime.node'].map(name => join(native, name))])
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', path]);
const requirement = path => execFileSync('/usr/bin/codesign', ['-d', '-r-', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
// codesign prints the designated requirement on stdout; other diagnostics go to stderr.
const designated = requirement(bundle).trim();
assert.match(designated, /identifier "studio.pi.desktop"/);
assert.match(designated, /certificate leaf/);
const installed = join(process.env.HOME, 'Applications/Pi Studio.app');
assert.equal(designated, requirement(installed).trim());
const minimumOS = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :LSMinimumSystemVersion', join(bundle, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
assert.equal(minimumOS, '13.0');
const archive = join(root, 'dist', `Pi-Studio-${metadata.version}-mac-${process.arch}.zip`);
const proof = { checkedAt: new Date().toISOString(), source, version: metadata.version, architecture: process.arch, minimumOS, archiveBytes: (await stat(archive)).size, archiveSha256: hash(await readFile(archive)), compiledOutputMatches: true, bridgeMatches: true, sdkAndJsRuntimeMatch: true, nativeSdkVersion: '0.49.11', nativeBinariesSeparatelySignedAndVerified: true, deepStrictSignature: true, designatedRequirementMatchesInstalled: true, licenseAndExactSourceNoticesMatch: true, limits: 'Local signed package, not notarized or installed. Offscreen packaged-main tests are separate. Actual Pi Studio TCC, desktop capture/input and model visual loop still need acceptance.' };
await writeFile(join(root, 'artifacts/cua-package-proof.json'), JSON.stringify(proof, null, 2) + '\n');
console.log(JSON.stringify(proof));
