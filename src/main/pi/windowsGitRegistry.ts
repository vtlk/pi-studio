import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { win32 } from 'node:path';
import { powershellArguments, windowsPowershell } from './windowsShell.ts';

const execute = promisify(execFile);
// Git for Windows' installer records InstallPath in HKCU or HKLM:
// https://github.com/git-for-windows/build-extra/blob/main/installer/install.iss
const script = String.raw`
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$paths = [System.Collections.Generic.List[string]]::new()
foreach ($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryHive]::LocalMachine)) {
  foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
    $base = $null; $key = $null
    try {
      $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
      $key = $base.OpenSubKey('Software\GitForWindows')
      if ($null -ne $key) {
        $value = $key.GetValue('InstallPath', $null)
        if ($value -is [string] -and -not [string]::IsNullOrWhiteSpace($value)) { $paths.Add($value) }
      }
    } catch {} finally {
      if ($null -ne $key) { $key.Dispose() }
      if ($null -ne $base) { $base.Dispose() }
    }
  }
}
ConvertTo-Json -InputObject @($paths.ToArray()) -Compress`;

/** Read installation metadata only. Never launches Git/Bash, scans drives or requests elevation. */
export async function windowsGitInstallRoots(run = execute): Promise<string[]> {
  if (process.platform !== 'win32' && run === execute) return [];
  try {
    const { stdout } = await run(windowsPowershell(), powershellArguments(script), {
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 16384,
      encoding: 'utf8',
    });
    const values: unknown = JSON.parse(stdout.replace(/^\uFEFF/, ''));
    if (!Array.isArray(values) || values.length > 8) return [];
    const seen = new Set<string>();
    return values.flatMap((value) => {
      // Avoid network/relative/device paths and stale or malformed registry entries.
      if (typeof value !== 'string' || value.length > 2048 || !/^[a-z]:[\\/]/i.test(value))
        return [];
      const path = win32.normalize(value),
        key = path.toLowerCase();
      if (seen.has(key)) return [];
      seen.add(key);
      return [path];
    });
  } catch {
    return []; // Registry availability is not evidence of a usable shell.
  }
}
