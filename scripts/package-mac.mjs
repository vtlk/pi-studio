import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { homedir } from 'node:os';

if (process.platform !== 'darwin') throw new Error('Packaging Pi Studio requires macOS.');
const root = resolve(import.meta.dirname, '..');
const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
// Documents may be cloud-managed and acquire FinderInfo during signing. Build in local cache.
const targetRoot = join(
  homedir(),
  'Library/Caches/Pi Studio/builds',
  metadata.version,
  `mac-${process.arch}`,
);
const bundle = join(targetRoot, 'Pi Studio.app');
await mkdir(targetRoot, { recursive: true });
await rm(bundle, { recursive: true, force: true });
await cp(join(root, 'node_modules/electron/dist/Electron.app'), bundle, {
  recursive: true,
  verbatimSymlinks: true,
  mode: constants.COPYFILE_FICLONE,
});
await rename(join(bundle, 'Contents/MacOS/Electron'), join(bundle, 'Contents/MacOS/Pi Studio'));
const resources = join(bundle, 'Contents/Resources');
execFileSync(process.execPath, [join(root, 'scripts/build-icon.mjs')]);
await cp(join(root, 'build/PiStudio.icns'), join(resources, 'PiStudio.icns'));
await rm(join(resources, 'default_app.asar'), { force: true });
const application = join(resources, 'app');
await mkdir(application, { recursive: true });
const licenses = join(application, 'licenses');
await mkdir(licenses, { recursive: true });
for (const [source, name] of [
  ['@remotion/player/LICENSE.md', 'Remotion-LICENSE.md'],
  ['mediabunny/LICENSE', 'Mediabunny-LICENSE.txt'],
  ['zod/LICENSE', 'Zod-LICENSE.txt'],
])
  await cp(join(root, 'node_modules', source), join(licenses, name));
await writeFile(
  join(licenses, 'README.txt'),
  [
    'Pi Studio bundled montage preview dependencies (unmodified upstream code):',
    'remotion, @remotion/player, @remotion/media 4.0.543: Remotion License; see Remotion-LICENSE.md.',
    'Source: https://github.com/remotion-dev/remotion/tree/v4.0.543',
    'Mediabunny 1.64.0: MPL-2.0; see Mediabunny-LICENSE.txt.',
    'Corresponding source: https://registry.npmjs.org/mediabunny/-/mediabunny-1.64.0.tgz (includes src/).',
    'Zod 4.6.7: MIT; see Zod-LICENSE.txt. Source: https://github.com/colinhacks/zod',
    'Editor Starter and Remotion Timeline are not included.',
    '',
  ].join('\n'),
);
await cp(join(root, 'out'), join(application, 'out'), {
  recursive: true,
  filter: (source) =>
    !['characters', 'scenes', 'library-runtime', 'source.json'].includes(source.split('/').at(-1)),
});
await cp(join(root, 'node_modules/yaml'), join(application, 'node_modules/yaml'), {
  recursive: true,
});
await cp(join(root, 'bundled/pi-bridge'), join(application, 'bundled/pi-bridge'), {
  recursive: true,
});
await cp(join(root, 'bundled/pi-runtime'), join(application, 'bundled/pi-runtime'), {
  recursive: true,
});
await writeFile(
  join(application, 'package.json'),
  `${JSON.stringify(
    {
      name: metadata.name,
      version: metadata.version,
      description: metadata.description,
      main: metadata.main,
    },
    null,
    2,
  )}\n`,
);
const plist = join(bundle, 'Contents/Info.plist');
for (const [key, value] of Object.entries({
  CFBundleDisplayName: 'Pi Studio',
  CFBundleName: 'Pi Studio',
  CFBundleIdentifier: 'studio.pi.desktop',
  CFBundleExecutable: 'Pi Studio',
  CFBundleIconFile: 'PiStudio.icns',
  CFBundleShortVersionString: metadata.version.split('-')[0],
  CFBundleVersion: metadata.version.split('-')[0],
  NSHumanReadableCopyright: 'Pi Studio',
}))
  execFileSync('/usr/bin/plutil', ['-replace', key, '-string', value, plist]);
// Source media can carry Finder metadata; strip it only from the generated distribution copy.
execFileSync('/usr/bin/xattr', ['-cr', bundle]);
execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle], {
  stdio: 'inherit',
});
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'inherit' });
const archive = join(root, 'dist', `Pi-Studio-${metadata.version}-mac-${process.arch}.zip`);
await mkdir(join(root, 'dist'), { recursive: true });
await rm(archive, { force: true });
execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', bundle, archive]);
for (const file of await readdir(join(root, 'dist'))) {
  if (
    /^Pi-Studio-.*-mac-(arm64|x64)\.zip$/.test(file) &&
    !file.startsWith(`Pi-Studio-${metadata.version}-`)
  )
    await rm(join(root, 'dist', file));
}
console.log(
  `Application: ${bundle}\nArchive: ${archive}\nSignature: local ad-hoc (not notarized).`,
);
