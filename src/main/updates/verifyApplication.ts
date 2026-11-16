import { t } from '../../shared/i18n/index.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { UpdateManifest } from '../../shared/updates.ts';
import { powershellArguments, powershellLiteral, windowsPowershell } from '../pi/windowsShell.ts';

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
  await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', root], { timeout: 30000 });
  const result = await execute('/usr/bin/codesign', ['-d', '-r-', root]);
  const requirement = result.stdout.split('designated => ')[1]?.trim();
  if (!requirement || /^cdhash\b/.test(requirement))
    throw new Error(t('error.verifyApplication.theAppHasNoPermanent'));
  return requirement;
}
async function windowsSigner(path: string) {
  const { stdout } = await execute(
    windowsPowershell(),
    powershellArguments(
      `$s=Get-AuthenticodeSignature -LiteralPath ${powershellLiteral(path)}; @{status=[string]$s.Status;thumbprint=$s.SignerCertificate.Thumbprint}|ConvertTo-Json -Compress`,
    ),
    { windowsHide: true, timeout: 15000 },
  );
  return JSON.parse(stdout) as { status: string; thumbprint?: string };
}
/** Archive signatures authenticate both platforms; a signed installed binary additionally pins its OS publisher. */
export async function verifyApplication(
  candidate: string,
  current: string,
  manifest: UpdateManifest,
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
      { timeout: 30000 },
    );
    const { stdout: id } = await execute('/usr/bin/plutil', [
      '-extract',
      'CFBundleIdentifier',
      'raw',
      '-o',
      '-',
      join(candidate, 'Contents/Info.plist'),
    ]);
    const { stdout: architectures } = await execute('/usr/bin/lipo', ['-archs', executable]);
    if (
      id.trim() !== 'studio.pi.desktop' ||
      !architectures
        .trim()
        .split(/\s+/)
        .includes(manifest.arch === 'x64' ? 'x86_64' : manifest.arch)
    )
      throw new Error(t('error.verifyApplication.macAppIdentifierOrArchitecture'));
  } else {
    const handle = await open(executable, 'r');
    try {
      const header = Buffer.alloc(64);
      await handle.read(header, 0, 64, 0);
      const offset = header.readUInt32LE(60);
      if (header.toString('ascii', 0, 2) !== 'MZ' || offset < 64 || offset > 10 * 1024 ** 2)
        throw new Error(t('error.verifyApplication.invalidWindowsExecutable'));
      const pe = Buffer.alloc(6);
      const { bytesRead } = await handle.read(pe, 0, 6, offset);
      if (bytesRead !== 6 || pe.readUInt32LE(0) !== 0x4550 || pe.readUInt16LE(4) !== 0x8664)
        throw new Error(t('error.verifyApplication.theUpdateRequiresAWindows'));
    } finally {
      await handle.close();
    }
    const before = await windowsSigner(applicationExecutable(current, 'win32'));
    if (before.thumbprint) {
      const after = await windowsSigner(executable);
      if (after.status !== 'Valid' || !before.thumbprint || after.thumbprint !== before.thumbprint)
        throw new Error(t('error.verifyApplication.theWindowsSignaturePublisherChanged'));
    }
  }
}
