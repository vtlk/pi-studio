import { t } from '../../shared/i18n/index.ts';
import { chmod, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { windowsPowershell, powershellArguments } from '../pi/windowsShell.ts';
const execute = promisify(execFile);
export async function privateDirectory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') {
    await chmod(path, 0o700);
    return;
  }
  const { stdout } = await execute(
    windowsPowershell(),
    powershellArguments('[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'),
    { windowsHide: true, timeout: 10000 },
  );
  const sid = stdout.trim();
  if (!/^S-1-[0-9-]+$/.test(sid))
    throw new Error(t('error.privateDirectory.couldNotDetermineTheUpdate'));
  // Restrict this newly owned staging directory, without changing user credential-store ACLs.
  await execute(
    'icacls.exe',
    [path, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '/grant:r', '*S-1-5-18:(OI)(CI)F'],
    { windowsHide: true, timeout: 10000 },
  );
}
