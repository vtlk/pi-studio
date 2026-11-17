import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, win32, posix } from 'node:path';

/** Use Pi's own Node distribution, including its npm JS entry points; no global install or cmd shell. */
export function nodeTools(
  node = realpathSync(process.execPath),
  platform = process.platform,
  exists = existsSync,
) {
  const path = platform === 'win32' ? win32 : posix;
  const root = path.dirname(node);
  const npmRoots = [
    path.join(root, 'node_modules/npm'),
    path.join(root, '../lib/node_modules/npm'),
  ];
  const npmRoot = npmRoots.find((directory) => exists(path.join(directory, 'bin/npm-cli.js')));
  return {
    node: { command: node, args: [] },
    ...(npmRoot
      ? {
          npm: { command: node, args: [path.join(npmRoot, 'bin/npm-cli.js')] },
          ...(exists(path.join(npmRoot, 'bin/npx-cli.js'))
            ? {
                npx: { command: node, args: [path.join(npmRoot, 'bin/npx-cli.js')] },
              }
            : {}),
        }
      : {}),
  };
}

export function runtimeInformation() {
  const commands = nodeTools();
  let npmVersion;
  if (commands.npm) {
    try {
      npmVersion = JSON.parse(
        readFileSync(join(dirname(commands.npm.args[0]), '../package.json'), 'utf8'),
      ).version;
    } catch {
      /* Presence is separate from version metadata. */
    }
  }
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    npmVersion,
    commands,
  };
}

/** Keep explicit paths and custom PATH choices. Bare npm/npx must not depend on Windows .cmd execution. */
export function withNodeCommand(entry, commands = nodeTools()) {
  const config = entry.config;
  if (
    typeof config.command !== 'string' ||
    Object.keys(config.env ?? {}).some((key) => key.toLowerCase() === 'path')
  )
    return entry;
  const match = /^(node|npm|npx)(?:\.exe|\.cmd|\.bat)?$/i.exec(config.command);
  const selected = match && commands[match[1].toLowerCase()];
  if (!selected) return entry;
  return {
    ...entry,
    config: {
      ...config,
      command: selected.command,
      args: [...selected.args, ...(config.args ?? [])],
    },
  };
}

export function npmSettings() {
  const npm = nodeTools().npm;
  return npm ? { npmCommand: [npm.command, ...npm.args] } : {};
}
