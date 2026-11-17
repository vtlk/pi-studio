import { t } from '../../shared/i18n/index.ts';
import { chmod, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { win32 } from 'node:path';

const execute = promisify(execFile);
interface DirectoryOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  execute?: typeof execute;
}
export async function privateDirectory(path: string, options: DirectoryOptions = {}) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if ((options.platform ?? process.platform) !== 'win32') {
    await chmod(path, 0o700);
    return;
  }
  const run = options.execute ?? execute;
  const system = win32.join((options.env ?? process.env).SystemRoot ?? 'C:\\Windows', 'System32');
  let sid: string | undefined;
  try {
    // Read the current process account in locale-independent CSV. Do not depend on
    // PowerShell/.NET execution being available just to protect update staging.
    const { stdout } = await run(win32.join(system, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], {
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 16384,
      encoding: 'utf8',
    });
    sid = /^\s*"(?:[^"\r\n]|"")*","(S-1-\d+(?:-\d+){1,15})"\s*$/.exec(stdout)?.[1];
  } catch (cause) {
    throw new Error(t('error.privateDirectory.couldNotDetermineTheUpdate'), { cause });
  }
  if (!sid) throw new Error(t('error.privateDirectory.couldNotDetermineTheUpdate'));
  // Restrict only this newly owned staging directory. SID grants avoid localized
  // account names; never continue with an unprotected directory on command failure.
  try {
    await run(
      win32.join(system, 'icacls.exe'),
      [path, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'],
      { windowsHide: true, timeout: 10000, maxBuffer: 16384 },
    );
  } catch (cause) {
    throw new Error(t('error.privateDirectory.couldNotProtectTheUpdate'), { cause });
  }
}
