import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, win32, join, delimiter } from 'node:path';

/** Existence/executable permission only. Never executes the imported command. */
export async function missingMcpExecutable(
  config: Record<string, unknown>,
  path: string,
  windows = process.platform === 'win32',
) {
  if (typeof config.command !== 'string') return false;
  const command = config.command;
  const absolute = isAbsolute(command) || win32.isAbsolute(command);
  const candidates = absolute
    ? [command]
    : path
        .split(windows ? ';' : delimiter)
        .filter(Boolean)
        .flatMap((root) =>
          (windows && !/\.(exe|cmd|bat|com)$/i.test(command)
            ? ['', '.exe', '.cmd', '.bat', '.com']
            : ['']
          ).map((suffix) => join(root, command + suffix)),
        );
  for (const candidate of candidates) {
    try {
      await access(candidate, windows ? constants.F_OK : constants.X_OK);
      return false;
    } catch {
      /* Next explicit PATH entry. */
    }
  }
  return true;
}
