import { existsSync } from 'node:fs';
import { win32 } from 'node:path';

/** Host discovery is authoritative; the SDK must not search again and select another Bash/WSL. */
export function nativeBash(platform = process.platform, env = process.env, exists = existsSync) {
  if (platform !== 'win32') return undefined;
  const path = env.PI_STUDIO_NATIVE_BASH;
  if (typeof path !== 'string' || !/^[a-z]:[\\/]/i.test(path) || path.includes('\0'))
    return undefined;
  const normalized = win32.normalize(path).toLowerCase();
  if (
    ['system32', 'sysnative', 'syswow64', 'windowsapps'].includes(
      win32.basename(win32.dirname(normalized)),
    )
  )
    return undefined;
  return exists(path) ? path : undefined;
}

export function shellSettings(platform = process.platform, env = process.env, exists = existsSync) {
  if (platform !== 'win32') return {};
  const bash = nativeBash(platform, env, exists);
  return {
    defaultTools: ['read', 'powershell', 'edit', 'write'],
    ...(bash ? { shellPath: bash } : {}),
  };
}

export function shellToolOptions(
  platform = process.platform,
  env = process.env,
  exists = existsSync,
) {
  return platform === 'win32' && !nativeBash(platform, env, exists)
    ? { excludeTools: ['bash'] }
    : {};
}

export function commandExamples(commands, platform = process.platform) {
  const quote =
    platform === 'win32'
      ? (value) => `'${value.replaceAll("'", "''")}'`
      : (value) => `'${value.replaceAll("'", `'"'"'`)}'`;
  return Object.fromEntries(
    Object.entries(commands).map(([name, tool]) => [
      name,
      (platform === 'win32' ? '& ' : '') + [tool.command, ...tool.args].map(quote).join(' '),
    ]),
  );
}

export function shellGuidance(platform = process.platform) {
  return platform === 'win32'
    ? "Current operating system: Windows. The primary command tool is native powershell, already active alongside read/edit/write. Use PowerShell syntax for ordinary Windows commands and dependency installation; for an executable path with spaces use the call operator: & 'C:\\path to\\node.exe' 'C:\\path to\\npm-cli.js' <arguments>. The get_runtime tool, when assigned, returns current paths and ready-to-use command examples; otherwise inspect commands with Get-Command in the current environment. Do not send PowerShell syntax to bash or require Git Bash to run Node/npm/npx/FFmpeg. Git is needed for Git operations; Bash is optional for explicitly Unix-dependent tasks and is available only when Studio found a real native Git Bash. Do not invent shell paths, use WSL, or change global PATH to repair Studio. A missing optional Bash is not a failed Node/PowerShell installation."
    : 'Current operating system: macOS. Use the native bash command tool with read/edit/write and the current runtime paths.';
}
