import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { basename, delimiter, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { piEnvironment } from './platform.ts';
import { powershellArguments, powershellLiteral, windowsPowershell } from './windowsShell.ts';

const execute = promisify(execFile);
async function terminal() {
  const paths = [
    ...piEnvironment('').PATH.split(delimiter),
    ...(process.env.LOCALAPPDATA ? [join(process.env.LOCALAPPDATA, 'Microsoft/WindowsApps')] : []),
  ];
  for (const root of paths) {
    const path = join(root, 'wt.exe');
    try {
      await access(path);
      return path;
    } catch {
      /* Next location. */
    }
  }
  throw new Error(
    'Для диалогов Pi установите Windows Terminal из Microsoft Store и повторите открытие.',
  );
}
const titleArgument = (title: string) => title.replace(/[;"\p{Cc}]/gu, ' ').slice(0, 300);

/** A dedicated named window per live bridge. Encoded PowerShell carries paths as literals. */
export async function openWindowsSession(
  node: string,
  bridge: string,
  bootstrap: string,
  title = 'Pi Studio',
) {
  const name = basename(bootstrap, '.json');
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(name)) throw new Error('Некорректный ID окна Pi.');
  const env = piEnvironment(dirname(node));
  const script = `$env:PATH = ${powershellLiteral(env.PATH)}; $env:PI_TELEMETRY = '0'; $env:PI_OFFLINE = '1'; & ${powershellLiteral(node)} ${powershellLiteral(bridge)} ${powershellLiteral(bootstrap)}; exit $LASTEXITCODE`;
  await execute(
    await terminal(),
    [
      '-w',
      `pi-studio-${name}`,
      'new-tab',
      '--title',
      titleArgument(title),
      '--suppressApplicationTitle',
      windowsPowershell(),
      ...powershellArguments(script),
    ],
    { timeout: 15000, maxBuffer: 10000, windowsHide: true },
  );
}

export async function focusWindowsSession(pid: number) {
  if (!Number.isSafeInteger(pid) || pid < 2) throw new Error('Некорректный процесс Pi.');
  const { stdout } = await execute(
    windowsPowershell(),
    powershellArguments(`(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`),
    { timeout: 5000, maxBuffer: 16384, windowsHide: true },
  );
  const id =
    stdout.includes('session.mjs') &&
    stdout.match(
      /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json(?:"|\s|$)/i,
    )?.[1];
  if (!id) throw new Error('Окно выбранного диалога Pi недоступно. Дождитесь завершения процесса.');
  // No new-tab or user input on focus. A closed bridge is handled by RunHost's normal reopen.
  await execute(await terminal(), ['-w', `pi-studio-${id}`, 'focus-tab', '-t', '0'], {
    timeout: 10000,
    maxBuffer: 10000,
    windowsHide: true,
  });
}

/** Existing explicit CLI operations use the same native Git Bash supported by Pi. */
export async function openWindowsShellCommand(command: string, title = 'Pi Studio') {
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(
    (root): root is string => !!root,
  );
  const candidates = [
    ...roots.map((root) => join(root, 'Git/bin/bash.exe')),
    ...piEnvironment('')
      .PATH.split(delimiter)
      .map((root) => join(root, 'bash.exe')),
  ];
  let bash: string | undefined;
  for (const path of candidates) {
    try {
      await access(path);
      bash = path;
      break;
    } catch {
      /* Next location. */
    }
  }
  if (!bash) throw new Error('Установите Git for Windows (Git Bash), затем повторите действие.');
  const script = `& ${powershellLiteral(bash)} '-lc' ${powershellLiteral(command)}; exit $LASTEXITCODE`;
  await openWindowsPowerShellCommand(script, title);
}

export async function openWindowsPowerShellCommand(script: string, title: string) {
  await execute(
    await terminal(),
    [
      '-w',
      'new',
      'new-tab',
      '--title',
      titleArgument(title),
      windowsPowershell(),
      ...powershellArguments(script),
    ],
    { timeout: 15000, maxBuffer: 10000, windowsHide: true },
  );
}
