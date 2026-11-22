import { t } from '../../shared/i18n/index.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import type { UpdateManifest } from '../../shared/updates.ts';
import { powershellArguments, windowsPowershell } from '../pi/windowsShell.ts';

const execute = promisify(execFile);
export async function applicationIdentity(path: string) {
  const info = await lstat(path, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(path)) !== path)
    throw new Error(t('error.verifyApplication.theAppMustBeIn'));
  return {
    dev: info.dev.toString(),
    ino: info.ino.toString(),
    birthtimeNs: info.birthtimeNs.toString(),
  };
}
export function applicationExecutable(root: string, platform: string) {
  return join(root, platform === 'darwin' ? 'Contents/MacOS/Pi Studio' : 'Pi Studio.exe');
}
export function applicationMetadata(root: string, platform: string) {
  return join(
    root,
    platform === 'darwin' ? 'Contents/Resources/app/package.json' : 'resources/app/package.json',
  );
}
async function ordinaryFile(root: string, path: string) {
  const info = await lstat(path);
  const location = relative(root, await realpath(path));
  if (!info.isFile() || info.isSymbolicLink() || location.startsWith('..'))
    throw new Error(t('error.verifyApplication.invalidAppStructureInThe'));
}
export async function designatedRequirement(root: string) {
  // Full bundle verification traverses hundreds of MB, including on a cold/slow disk.
  await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', root], { timeout: 120000 });
  const result = await execute('/usr/bin/codesign', ['-d', '-r-', root], { timeout: 10000 });
  const requirement = result.stdout.split('designated => ')[1]?.trim();
  if (!requirement || /^cdhash\b/.test(requirement))
    throw new Error(t('error.verifyApplication.theAppHasNoPermanent'));
  return requirement;
}
async function windowsSigner(path: string) {
  try {
    const { stdout } = await execute(
      windowsPowershell(),
      powershellArguments(
        "$s=Get-AuthenticodeSignature -LiteralPath '.\\Pi Studio.exe'; @{status=[string]$s.Status;thumbprint=$s.SignerCertificate.Thumbprint}|ConvertTo-Json -Compress",
      ),
      { cwd: dirname(path), windowsHide: true, timeout: 30000, maxBuffer: 16384 },
    );
    return JSON.parse(stdout) as { status: string; thumbprint?: string };
  } catch {
    throw new Error(t('error.verifyApplication.windowsSignatureCheckFailed'));
  }
}

/** Read the PE32+ header and determine whether the executable has an embedded certificate table. */
async function windowsHasCertificate(executable: string) {
  const invalid = () => new Error(t('error.verifyApplication.invalidWindowsExecutable'));
  const handle = await open(executable, 'r');
  try {
    const dos = Buffer.alloc(64);
    if ((await handle.read(dos, 0, dos.length, 0)).bytesRead !== dos.length) throw invalid();
    const offset = dos.readUInt32LE(60);
    if (dos.toString('ascii', 0, 2) !== 'MZ' || offset < 64 || offset > 10 * 1024 ** 2)
      throw invalid();

    // PE signature + 20-byte COFF header, then the declared PE32+ optional header.
    const coff = Buffer.alloc(24);
    if (
      (await handle.read(coff, 0, coff.length, offset)).bytesRead !== coff.length ||
      coff.readUInt32LE(0) !== 0x4550 ||
      coff.readUInt16LE(4) !== 0x8664
    )
      throw new Error(t('error.verifyApplication.theUpdateRequiresAWindows'));
    const optional = Buffer.alloc(coff.readUInt16LE(20));
    const dataDirectories = 112;
    if (
      optional.length < dataDirectories ||
      (await handle.read(optional, 0, optional.length, offset + coff.length)).bytesRead !==
        optional.length ||
      optional.readUInt16LE(0) !== 0x20b
    )
      throw invalid();
    const count = optional.readUInt32LE(108);
    const directorySize = 8;
    if (dataDirectories + count * directorySize > optional.length) throw invalid();
    const securityIndex = 4;
    if (count <= securityIndex) return false;
    const certificateEntry = dataDirectories + securityIndex * directorySize;
    // Unlike other data directories, the Certificate Table points to a file offset.
    const position = optional.readUInt32LE(certificateEntry);
    const size = optional.readUInt32LE(certificateEntry + 4);
    if (position === 0 && size === 0) return false;
    if (
      position < offset + coff.length + optional.length ||
      position % 8 !== 0 ||
      size < directorySize ||
      position + size > (await handle.stat()).size
    )
      throw invalid();
    return true;
  } finally {
    await handle.close();
  }
}

/** Archive signatures authenticate both platforms; an embedded Windows signature additionally pins its publisher. */
export async function verifyApplication(
  candidate: string,
  current: string,
  manifest: UpdateManifest,
  readWindowsSigner = windowsSigner,
) {
  await applicationIdentity(candidate);
  const metadata = applicationMetadata(candidate, manifest.platform);
  const executable = applicationExecutable(candidate, manifest.platform);
  await ordinaryFile(candidate, metadata);
  await ordinaryFile(candidate, executable);
  const info = JSON.parse(await readFile(metadata, 'utf8'));
  if (info.name !== 'pi-video-studio' || info.version !== manifest.version)
    throw new Error(t('error.verifyApplication.theAppVersionInsideThe'));
  if (manifest.platform === 'darwin') {
    const requirement = await designatedRequirement(current);
    await execute(
      '/usr/bin/codesign',
      ['--verify', '--deep', '--strict', `-R=${requirement}`, candidate],
      { timeout: 120000 },
    );
    const { stdout: id } = await execute(
      '/usr/bin/plutil',
      ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', join(candidate, 'Contents/Info.plist')],
      { timeout: 10000 },
    );
    const { stdout: architectures } = await execute('/usr/bin/lipo', ['-archs', executable], {
      timeout: 10000,
    });
    if (
      id.trim() !== 'studio.pi.desktop' ||
      !architectures
        .trim()
        .split(/\s+/)
        .includes(manifest.arch === 'x64' ? 'x86_64' : manifest.arch)
    )
      throw new Error(t('error.verifyApplication.macAppIdentifierOrArchitecture'));
  } else {
    const installed = applicationExecutable(current, 'win32');
    await ordinaryFile(current, installed);
    const candidateSigned = await windowsHasCertificate(executable);
    const installedSigned = await windowsHasCertificate(installed);
    // Official portable releases have no Authenticode certificate. Their archive is
    // authenticated by the signed release manifest and its SHA-256 before extraction.
    if (!installedSigned) return;
    if (!candidateSigned)
      throw new Error(t('error.verifyApplication.theWindowsSignaturePublisherChanged'));
    const before = await readWindowsSigner(installed);
    const after = await readWindowsSigner(executable);
    if (!before?.thumbprint || after?.status !== 'Valid' || after.thumbprint !== before.thumbprint)
      throw new Error(t('error.verifyApplication.theWindowsSignaturePublisherChanged'));
  }
}
