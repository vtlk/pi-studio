import test from 'node:test';
import assert from 'node:assert/strict';
import { findWindowsBash } from '../src/main/pi/windowsBash.ts';

test('native Git Bash wins over the Windows WSL shim in PATH', async () => {
  const probes: string[] = [];
  const found = await findWindowsBash(
    { ProgramFiles: 'C:\\Program Files', Path: 'C:\\Windows\\System32;D:\\Tools' },
    async (path) => {
      probes.push(path);
      return true;
    },
  );
  assert.equal(found, 'C:\\Program Files\\Git\\bin\\bash.exe');
  assert.deepEqual(probes, [found]);
});

test('a per-user Git install is found without changing PATH or installing anything', async () => {
  const found = await findWindowsBash(
    { LOCALAPPDATA: "D:\\Users\\O'Brien Тест\\AppData\\Local", Path: 'C:\\Windows\\System32' },
    async (path) => path.includes('Programs\\Git\\bin'),
  );
  assert.equal(found, "D:\\Users\\O'Brien Тест\\AppData\\Local\\Programs\\Git\\bin\\bash.exe");
});

test('WSL system and App Execution aliases never substitute for a missing native Bash', async () => {
  const checked: string[] = [];
  await assert.rejects(
    findWindowsBash(
      {
        systemroot: 'D:\\OS',
        LOCALAPPDATA: 'D:\\Local',
        PATH: 'D:/OS/System32;d:\\os\\Sysnative;D:\\OS\\SysWOW64;D:\\Local\\Microsoft\\WindowsApps;C:\\Windows\\System32',
      },
      async (path) => {
        checked.push(path);
        return path.toLowerCase().includes('windowsapps') || /sys(?:tem32|native|wow64)/i.test(path);
      },
    ),
    /Git/,
  );
  assert.deepEqual(checked, ['D:\\Local\\Programs\\Git\\bin\\bash.exe']);
});

test('custom native Bash paths remain supported, normalized and deduplicated', async () => {
  const checked: string[] = [];
  const found = await findWindowsBash(
    { PATH: '"D:\\Missing Bash";D:\\MISSING BASH;E:\\Portable Git\\bin' },
    async (path) => {
      checked.push(path);
      return path.startsWith('E:');
    },
  );
  assert.equal(found, 'E:\\Portable Git\\bin\\bash.exe');
  assert.deepEqual(checked, ['D:\\Missing Bash\\bash.exe', found]);
});
