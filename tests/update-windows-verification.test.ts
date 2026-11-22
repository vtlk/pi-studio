import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { UpdateManifest } from '../src/shared/updates.ts';
import {
  applicationExecutable,
  applicationMetadata,
  verifyApplication,
} from '../src/main/updates/verifyApplication.ts';

const manifest = { platform: 'win32', version: '0.2.0-alpha.140' } as UpdateManifest;
const certificateEntry = 64 + 24 + 112 + 4 * 8;

function executable(hasCertificate = false) {
  const bytes = Buffer.alloc(512);
  bytes.write('MZ');
  bytes.writeUInt32LE(64, 60);
  bytes.writeUInt32LE(0x4550, 64);
  bytes.writeUInt16LE(0x8664, 68);
  bytes.writeUInt16LE(240, 84);
  bytes.writeUInt16LE(0x20b, 88);
  bytes.writeUInt32LE(16, 88 + 108);
  if (hasCertificate) {
    bytes.writeUInt32LE(504, certificateEntry);
    bytes.writeUInt32LE(8, certificateEntry + 4);
  }
  return bytes;
}

async function fixture(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-win-update-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const current = join(root, 'Загрузки [QA]', 'Pi Studio');
  const candidate = join(root, '.pistudio-update-test', 'next', 'Pi Studio');
  const metadata = applicationMetadata(candidate, 'win32');
  const installedExe = applicationExecutable(current, 'win32');
  const candidateExe = applicationExecutable(candidate, 'win32');
  await mkdir(current, { recursive: true });
  await mkdir(dirname(metadata), { recursive: true });
  await writeFile(metadata, JSON.stringify({ name: 'pi-video-studio', version: manifest.version }));
  await writeFile(installedExe, executable());
  await writeFile(candidateExe, executable());
  return { current, candidate, installedExe, candidateExe };
}

test('portable Windows update verifies both EXEs without invoking PowerShell in Unicode folders', async (t) => {
  const { current, candidate } = await fixture(t);
  await verifyApplication(candidate, current, manifest, async () => {
    throw Error('PowerShell unavailable');
  });
});

test('an installed Authenticode certificate requires a valid matching candidate signer', async (t) => {
  const { current, candidate, installedExe, candidateExe } = await fixture(t);
  await writeFile(installedExe, executable(true));
  await assert.rejects(verifyApplication(candidate, current, manifest), /Издатель подписи/);
  await writeFile(candidateExe, executable(true));
  const checked: string[] = [];
  await verifyApplication(candidate, current, manifest, async (path) => {
    checked.push(path);
    return { status: 'Valid', thumbprint: 'same-publisher' };
  });
  assert.deepEqual(checked, [installedExe, candidateExe]);
  await assert.rejects(
    verifyApplication(candidate, current, manifest, async (path) => ({
      status: 'Valid',
      thumbprint: path === installedExe ? 'old-publisher' : 'other-publisher',
    })),
    /Издатель подписи/,
  );
  await assert.rejects(
    verifyApplication(candidate, current, manifest, async (path) => ({
      status: path === installedExe ? 'Valid' : 'HashMismatch',
      thumbprint: 'same-publisher',
    })),
    /Издатель подписи/,
  );
});

test('invalid PE or malformed certificate metadata cannot take the unsigned path', async (t) => {
  const { current, candidate, installedExe, candidateExe } = await fixture(t);
  const malformed = executable(true);
  malformed.writeUInt32LE(16, certificateEntry + 4);
  await writeFile(installedExe, malformed);
  await assert.rejects(verifyApplication(candidate, current, manifest), /Недопустимый исполняемый/);
  await writeFile(installedExe, executable());
  const wrongArchitecture = executable();
  wrongArchitecture.writeUInt16LE(0xaa64, 68);
  await writeFile(candidateExe, wrongArchitecture);
  await assert.rejects(verifyApplication(candidate, current, manifest), /Windows x64/);
  await writeFile(candidateExe, executable().subarray(0, 120));
  await assert.rejects(verifyApplication(candidate, current, manifest), /Недопустимый исполняемый/);
});
