import { mkdtemp, mkdir, writeFile, realpath, rm, readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import type { TestContext } from 'node:test';
import { updateZip, type ZipFixtureEntry } from './updateZip.ts';
import { writeInventory } from '../../bundled/update-helper/inventory.mjs';
import { NativeUpdateInstaller } from '../../src/main/updates/NativeUpdateInstaller.ts';
import type { UpdateManifest } from '../../src/shared/updates.ts';
import type { PreparedInstallation } from '../../src/main/updates/installation.ts';

export async function installerFixture(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-installer-')));
  const prepared: PreparedInstallation[] = [];
  t.after(async () => {
    for (const item of prepared) await item.dispose();
    await rm(root, { recursive: true, force: true });
  });
  const target = join(root, 'Pi Studio.app'),
    next = join(root, 'build/Pi Studio.app'),
    userData = join(root, 'userData');
  await mkdir(userData);
  for (const [directory, version] of [
    [target, '0.2.0-alpha.76'],
    [next, '0.2.0-alpha.77'],
  ]) {
    await mkdir(join(directory, 'Contents/MacOS'), { recursive: true });
    await mkdir(join(directory, 'Contents/Resources/app'), { recursive: true });
    await writeFile(join(directory, 'Contents/MacOS/Pi Studio'), 'inert, never launched', {
      mode: 0o755,
    });
    await writeFile(
      join(directory, 'Contents/Resources/app/package.json'),
      JSON.stringify({ name: 'pi-video-studio', version }),
    );
    await writeInventory(directory, 'darwin');
  }
  const entries: ZipFixtureEntry[] = [];
  async function walk(directory: string, prefix: string) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name),
        name = prefix + '/' + item.name;
      if (item.isDirectory()) await walk(path, name);
      else
        entries.push({
          name,
          text: await readFile(path, 'utf8'),
          mode: name.endsWith('MacOS/Pi Studio') ? 0o100755 : 0o100644,
        });
    }
  }
  await walk(next, 'Pi Studio.app');
  const bytes = updateZip(entries),
    archive = join(root, 'package.zip');
  await writeFile(archive, bytes);
  const manifest: UpdateManifest = {
    schema: 1,
    appId: 'studio.pi.desktop',
    version: '0.2.0-alpha.77',
    platform: 'darwin',
    arch: 'arm64',
    minOs: '13.0.0',
    format: 'mac-zip',
    sourceCommit: 'a'.repeat(40),
    archive: {
      name: 'Pi-Studio-0.2.0-alpha.77-mac-arm64.zip',
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      unpackedBytes: entries.reduce((sum, e) => sum + Buffer.byteLength(e.text!), 0),
    },
  };
  const options = {
    target,
    userData,
    version: '0.2.0-alpha.76',
    platform: 'darwin' as const,
    arch: 'arm64' as const,
    helperSource: resolve('bundled/update-helper'),
    protectedRoots: () => [userData],
    helperNode: async () => process.execPath,
    // Test fixture binaries are inert text; native signature verification is a separate gate.
    verify: async () => undefined,
    freeSpace: async () => 1024 ** 3,
  };
  return {
    root,
    target,
    userData,
    archive,
    manifest,
    options,
    installer: new NativeUpdateInstaller(options),
    track: (item: PreparedInstallation) => prepared.push(item),
    stages: async () =>
      (await readdir(dirname(target))).filter((name) => name.startsWith('.pistudio-update-')),
  };
}
