import { t } from '../../shared/i18n/index.ts';
import { ensureWindowsProfile } from './terminal-close/windowsProfile.ts';
import { execFile, spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { basename, delimiter, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { piEnvironment } from './platform.ts';
import { powershellArguments, powershellLiteral, windowsPowershell } from './windowsShell.ts';
import { findWindowsBash } from './windowsBash.ts';

const execute = promisify(execFile);
interface TerminalDependencies {
  execute?: (
    file: string,
    args: string[],
    options: { timeout: number; maxBuffer: number; windowsHide: boolean },
  ) => Promise<{ stdout: string; stderr?: string }>;
  terminal?: () => Promise<string>;
  profile?: () => Promise<string>;
  spawn?: typeof spawn;
}
/** A GUI launcher may live as long as its window. Never wait for or timeout-kill that process. */
function launchVisibleTerminal(file: string, args: string[], create = spawn) {
  return new Promise<void>((resolve, reject) => {
    const child = create(file, args, { detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
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
  throw new Error(t('error.windowsTerminal.forPiDialoguesInstallWindows'));
}

/** Existence only: never launches Terminal or PowerShell while evaluating Onboarding. */
export async function hasWindowsTerminal() {
  try {
    await terminal();
    return true;
  } catch {
    return false;
  }
}
const titleArgument = (title: string) => title.replace(/[;"\p{Cc}]/gu, ' ').slice(0, 300);

/** A dedicated named window per live bridge. Encoded PowerShell carries paths as literals. */
export async function openWindowsSession(
  node: string,
  bridge: string,
  bootstrap: string,
  title = 'Pi Studio',
  dependencies: TerminalDependencies = {},
) {
  const profile = await (dependencies.profile ?? ensureWindowsProfile)();
  const name = basename(bootstrap, '.json');
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(name))
    throw new Error(t('error.windowsTerminal.invalidPiWindowId'));
  const env = piEnvironment(dirname(node));
  const script = `$env:PATH = ${powershellLiteral(env.PATH)}; $env:PI_TELEMETRY = '0'; $env:PI_OFFLINE = '1'; & ${powershellLiteral(node)} ${powershellLiteral(bridge)} ${powershellLiteral(bootstrap)}; exit $LASTEXITCODE`;
  await launchVisibleTerminal(
    await (dependencies.terminal ?? terminal)(),
    [
      '-w',
      `pi-studio-${name}`,
      'new-tab',
      '--profile',
      profile,
      '--title',
      titleArgument(title),
      '--suppressApplicationTitle',
      windowsPowershell(),
      ...powershellArguments(script),
    ],
    dependencies.spawn,
  );
}

export async function focusWindowsSession(pid: number, dependencies: TerminalDependencies = {}) {
  if (!Number.isSafeInteger(pid) || pid < 2)
    throw new Error(t('error.windowsTerminal.invalidPiProcess'));
  const run = dependencies.execute ?? execute;
  const { stdout } = await run(
    windowsPowershell(),
    powershellArguments(`(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`),
    { timeout: 5000, maxBuffer: 16384, windowsHide: true },
  );
  const id =
    stdout.includes('session.mjs') &&
    stdout.match(
      /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json(?:"|\s|$)/i,
    )?.[1];
  if (!id) throw new Error(t('error.windowsTerminal.theSelectedPiDialogueS'));
  // No new-tab or user input on focus. A closed bridge is handled by RunHost's normal reopen.
  await launchVisibleTerminal(
    await (dependencies.terminal ?? terminal)(),
    ['-w', `pi-studio-${id}`, 'focus-tab', '-t', '0'],
    dependencies.spawn,
  );
}

/** Existing explicit CLI operations use the same native Git Bash supported by Pi. */
export async function openWindowsShellCommand(
  command: string,
  title = 'Pi Studio',
  dependencies: TerminalDependencies & { bash?: () => Promise<string> } = {},
) {
  const bash = await (dependencies.bash ?? findWindowsBash)();
  const script = `& ${powershellLiteral(bash)} '-lc' ${powershellLiteral(command)}; exit $LASTEXITCODE`;
  await openWindowsPowerShellCommand(script, title, dependencies);
}

export async function openWindowsPowerShellCommand(
  script: string,
  title: string,
  dependencies: TerminalDependencies = {},
) {
  await launchVisibleTerminal(
    await (dependencies.terminal ?? terminal)(),
    [
      '-w',
      'new',
      'new-tab',
      '--title',
      titleArgument(title),
      windowsPowershell(),
      ...powershellArguments(script),
    ],
    dependencies.spawn,
  );
}
