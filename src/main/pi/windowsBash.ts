import { access, stat } from 'node:fs/promises';
import { win32 } from 'node:path';
import { t } from '../../shared/i18n/index.ts';
import { windowsGitInstallRoots } from './windowsGitRegistry.ts';

/** Resolve a native Bash without accidentally launching Windows' WSL compatibility shim. */
export async function findWindowsBash(
  env: NodeJS.ProcessEnv = process.env,
  available: (path: string) => Promise<boolean> = async (path) => {
    try {
      await access(path);
      return (await stat(path)).isFile();
    } catch {
      return false;
    }
  },
  installedRoots: () => Promise<string[]> = windowsGitInstallRoots,
) {
  const values = (name: string) =>
    Object.entries(env)
      .filter(([key, value]) => key.toLowerCase() === name.toLowerCase() && !!value)
      .map(([, value]) => value!);
  const systemRoots = [...values('SystemRoot'), ...values('windir'), 'C:\\Windows'];
  const blocked = new Set(
    systemRoots.flatMap((root) =>
      ['System32', 'Sysnative', 'SysWOW64'].map((part) =>
        win32.join(root, part, 'bash.exe').toLowerCase(),
      ),
    ),
  );
  for (const root of values('LOCALAPPDATA'))
    blocked.add(win32.join(root, 'Microsoft/WindowsApps/bash.exe').toLowerCase());
  const candidates = [
    ...[...values('ProgramFiles'), ...values('ProgramFiles(x86)')].map((root) =>
      win32.join(root, 'Git/bin/bash.exe'),
    ),
    ...values('LOCALAPPDATA').map((root) => win32.join(root, 'Programs/Git/bin/bash.exe')),
    ...values('PATH').flatMap((path) =>
      path
        .split(';')
        .filter(Boolean)
        .flatMap((entry) => {
          const root = entry.replace(/^"(.*)"$/, '$1');
          return [
            win32.join(root, 'bash.exe'),
            ...(win32.basename(root).toLowerCase() === 'cmd'
              ? [win32.join(root, '../bin/bash.exe'), win32.join(root, '../usr/bin/bash.exe')]
              : []),
          ];
        }),
    ),
  ];
  const visited = new Set<string>();
  for (const path of candidates) {
    const key = win32.normalize(path).toLowerCase();
    if (blocked.has(key) || visited.has(key)) continue;
    visited.add(key);
    if (await available(path)) return path;
  }
  for (const root of await installedRoots()) {
    for (const directory of ['bin', 'usr/bin']) {
      const path = win32.join(root, directory, 'bash.exe');
      const key = path.toLowerCase();
      if (visited.has(key) || blocked.has(key)) continue;
      visited.add(key);
      if (await available(path)) return path;
    }
  }
  throw new Error(t('error.windowsTerminal.installGitForWindowsGit'));
}
