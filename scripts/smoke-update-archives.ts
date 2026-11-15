/** Read-only input packages; owned temporary ZIP is always removed. No GUI/model/user studio access. */
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectUpdateArchive } from '../src/main/updates/archive.ts';

const [macApp, windowsZip] = process.argv.slice(2);
if (
  process.platform !== 'darwin' ||
  !macApp?.endsWith('/Pi Studio.app') ||
  !windowsZip?.endsWith('-win-x64.zip')
)
  throw new Error(
    'Usage on macOS: smoke-update-archives.ts /absolute/Pi Studio.app /absolute/windows-win-x64.zip',
  );
const directory = await mkdtemp(join(tmpdir(), 'pistudio-update-archives-'));
try {
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', macApp], { stdio: 'pipe' });
  const version = JSON.parse(
    await readFile(join(macApp, 'Contents/Resources/app/package.json'), 'utf8'),
  ).version;
  const archive = join(directory, 'mac-readonly-input.zip');
  execFileSync(
    '/usr/bin/ditto',
    ['-c', '-k', '--norsrc', '--noextattr', '--keepParent', macApp, archive],
    { stdio: 'pipe', timeout: 120000 },
  );
  const mac = await inspectUpdateArchive(archive, 'darwin');
  const windows = await inspectUpdateArchive(windowsZip, 'win32');
  const proof = {
    checkedAt: new Date().toISOString(),
    baseHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    currentCheckoutHasUncommittedChanges:
      execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
    mac: {
      sourceVersion: version,
      signatureVerified: true,
      packagingFlags: ['--norsrc', '--noextattr'],
      bytes: (await stat(archive)).size,
      ...mac,
    },
    windows: { sourceArchive: windowsZip.split('/').at(-1), ...windows },
    extractionOrInstallationPerformed: false,
    applicationWindowsOpened: false,
    studioOrDialogueAccess: false,
    temporaryArchiveRemoved: false,
    scope:
      'Actual signed Mac app repackaged with production flags, and published Windows preview ZIP structure only; not an installed-app update cycle or native Windows acceptance.',
  };
  await rm(directory, { recursive: true, force: true });
  proof.temporaryArchiveRemoved = true;
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/update-archives-proof.json', JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof));
} finally {
  await rm(directory, { recursive: true, force: true });
}
