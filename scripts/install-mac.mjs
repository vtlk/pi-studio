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
const backup = join(cache, 'previous-application.app');
try {
  await cp(source, stage, {
    recursive: true,
    verbatimSymlinks: true,
    mode: constants.COPYFILE_FICLONE,
  });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', stage]);
  let exists = false;
  try {
    await access(target);
    exists = true;
  } catch {}
  if (exists) {
    await rm(backup, { recursive: true, force: true });
    await rename(target, backup);
  }
  try {
    await rename(stage, target);
  } catch (error) {
    if (exists) await rename(backup, target);
    throw error;
  }
  console.log(
    `Installed ${version}: ${target}\nPrevious application kept at: ${backup}\nProjects and user data were not changed.`,
  );
} finally {
  await rm(stage, { recursive: true, force: true });
}
