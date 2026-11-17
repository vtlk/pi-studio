import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { posix, win32 } from 'node:path';

const values = (env: NodeJS.ProcessEnv, name: string) =>
  Object.entries(env)
    .filter(([key, value]) => key.toLowerCase() === name.toLowerCase() && !!value)
    .map(([, value]) => value!);

/** Also available to already-running Studio children after a standard Git for Windows install. */
export function windowsGitDirectories(env: NodeJS.ProcessEnv) {
  return [
    ...[...values(env, 'ProgramFiles'), ...values(env, 'ProgramFiles(x86)')].map((root) =>
      win32.join(root, 'Git'),
    ),
    ...values(env, 'LOCALAPPDATA').map((root) => win32.join(root, 'Programs/Git')),
  ].flatMap((root) => ['cmd', 'bin'].map((part) => win32.join(root, part)));
}

/** Filesystem-only: never runs macOS' git shim, which can open the developer-tools installer. */
export async function findGit(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  available = async (file: string) => {
    try {
      await access(file, platform === 'win32' ? constants.F_OK : constants.X_OK);
      return (await stat(file)).isFile();
    } catch {
      return false;
    }
  },
) {
  const windows = platform === 'win32',
    path = windows ? win32 : posix;
  const directories = [
    ...values(env, 'PATH').flatMap((value) => value.split(windows ? ';' : ':')),
    ...(windows ? windowsGitDirectories(env) : []),
    ...(platform === 'darwin'
      ? [
          '/opt/homebrew/bin',
          '/usr/local/bin',
          '/Library/Developer/CommandLineTools/usr/bin',
          '/Applications/Xcode.app/Contents/Developer/usr/bin',
        ]
      : []),
  ];
  const visited = new Set<string>();
  for (const root of directories) {
    const directory = root.replace(/^"(.*)"$/, '$1');
    if (!path.isAbsolute(directory)) continue;
    const file = path.join(directory, windows ? 'git.exe' : 'git');
    const key = windows ? file.toLowerCase() : file;
    if (visited.has(key) || (platform === 'darwin' && file === '/usr/bin/git')) continue;
    visited.add(key);
    if (await available(file)) return file;
  }
}
