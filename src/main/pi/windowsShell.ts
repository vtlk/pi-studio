import { join, win32 } from 'node:path';

/** Single quoted PowerShell literals treat paths/names as data, including apostrophes and $. */
export const powershellLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;
export const powershellArguments = (script: string) => [
  '-NoLogo',
  '-NoProfile',
  '-NonInteractive',
  '-EncodedCommand',
  Buffer.from(`$ErrorActionPreference = 'Stop'; ${script}`, 'utf16le').toString('base64'),
];
export const windowsPowershell = () =>
  win32.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32/WindowsPowerShell/v1.0/powershell.exe',
  );
export const windowsTar = () => join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/tar.exe');
