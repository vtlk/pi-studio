import { cp, readFile, rename, rm, mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

if (process.platform !== 'darwin') throw new Error('Installation requires macOS.');
const root = resolve(import.meta.dirname, '..');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const cache = join(homedir(), 'Library/Caches/Pi Studio');
const source = join(cache, 'builds', version, `mac-${process.arch}`, 'Pi Studio.app');
const target = join(homedir(), 'Applications/Pi Studio.app');
const processes = execFileSync('/bin/ps', ['-axo', 'command='], { encoding: 'utf8' });
if (processes.split('\n').some((line) => line.startsWith(join(target, 'Contents/MacOS/Pi Studio'))))
  throw new Error('Quit the installed Pi Studio before updating it.');
await access(source);
await mkdir(join(homedir(), 'Applications'), { recursive: true });
await mkdir(cache, { recursive: true });
const stage = join(homedir(), 'Applications', `.PiStudio-update-${randomUUID()}.app`);
try {
  await cp(source, stage, {
    recursive: true,
    verbatimSymlinks: true,
    mode: constants.COPYFILE_FICLONE,
  });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', stage]);
  await rm(target, { recursive: true, force: true });
  await rename(stage, target);
  await rm(source, { recursive: true, force: true });
  console.log(
    `Installed ${version}: ${target}\nNo application backups created; temporary packaged app removed. Projects and user data were not changed.`,
  );
} finally {
  await rm(stage, { recursive: true, force: true });
}
