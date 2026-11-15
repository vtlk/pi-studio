import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { packageCua } from './package-cua.mjs';
import { verifyClaudePackage } from './verify-claude-package.mjs';

const root = resolve(import.meta.dirname, '..');
const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const electronVersion = '45.3.1';
const electronArchive = `electron-v${electronVersion}-win32-x64.zip`;
const electronSha256 = 'd92d1aa4700e3a7e7f174731f5086ebd9c21f9773e642b260160fe0a6ebe12d2';
const cuaIntegrity =
  'fTiUKzVGUKpVteQluu6W+HP9NfQPCVhv8XggR7v9xWtXMRXqlK1agrlsnIqBlTDLMKd4Iz+ajDGN5t9sEOmXAA==';
const stage = await mkdtemp(join(tmpdir(), 'pistudio-windows-x64-'));
const run = (file, args) =>
  execFileSync(file, args, { stdio: 'pipe', timeout: 120000, windowsHide: true });
const ps = (text) => [
  '-NoProfile',
  '-NonInteractive',
  '-EncodedCommand',
  Buffer.from(`$ErrorActionPreference = 'Stop'; ${text}`, 'utf16le').toString('base64'),
];
const literal = (text) => `'${text.replaceAll("'", "''")}'`;
const unpackZip = (archive, destination) =>
  process.platform === 'win32'
    ? run(
        'powershell.exe',
        ps(
          `Expand-Archive -LiteralPath ${literal(archive)} -DestinationPath ${literal(destination)}`,
        ),
      )
    : run('/usr/bin/ditto', ['-xk', archive, destination]);
try {
  await verifyClaudePackage(join(root, 'bundled/pi-claude-code'));
  const require = createRequire(join(root, 'node_modules/electron/install.js'));
  const { downloadArtifact } = require('@electron/get');
  const archive = await downloadArtifact({
    version: electronVersion,
    artifactName: 'electron',
    platform: 'win32',
    arch: 'x64',
    cacheRoot: join(stage, 'cache'),
    checksums: { [electronArchive]: electronSha256 },
  });
  if (
    createHash('sha256')
      .update(await readFile(archive))
      .digest('hex') !== electronSha256
  )
    throw Error('Electron Windows checksum mismatch.');
  const bundle = join(stage, 'Pi Studio');
  await mkdir(bundle);
  unpackZip(archive, bundle);
  await rename(join(bundle, 'electron.exe'), join(bundle, 'Pi Studio.exe'));
  await rm(join(bundle, 'resources/default_app.asar'), { force: true });
  const application = join(bundle, 'resources/app');
  await mkdir(join(application, 'licenses'), { recursive: true });
  await cp(join(root, 'out'), join(application, 'out'), { recursive: true });
  for (const name of ['pi-bridge', 'pi-runtime', 'pi-claude-code'])
    await cp(join(root, 'bundled', name), join(application, 'bundled', name), { recursive: true });
  for (const name of ['yaml', 'saxes', 'xmlchars'])
    await cp(join(root, 'node_modules', name), join(application, 'node_modules', name), {
      recursive: true,
    });
  for (const [source, name] of [
    ['@remotion/player/LICENSE.md', 'Remotion-LICENSE.md'],
    ['mediabunny/LICENSE', 'Mediabunny-LICENSE.txt'],
    ['zod/LICENSE', 'Zod-LICENSE.txt'],
    ['xmlchars/LICENSE', 'Xmlchars-LICENSE.txt'],
  ])
    await cp(join(root, 'node_modules', source), join(application, 'licenses', name));
  await cp(
    join(root, 'third-party-licenses/Saxes-LICENSE.txt'),
    join(application, 'licenses/Saxes-LICENSE.txt'),
  );
  const response = await fetch(
    'https://registry.npmjs.org/@trycua/cua-driver-win32-x64-msvc/-/cua-driver-win32-x64-msvc-0.49.11.tgz',
    { signal: AbortSignal.timeout(120000) },
  );
  if (!response.ok || Number(response.headers.get('content-length')) > 40 * 1024 ** 2)
    throw Error('Cannot download Windows Cua SDK.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (
    bytes.length > 40 * 1024 ** 2 ||
    createHash('sha512').update(bytes).digest('base64') !== cuaIntegrity
  )
    throw Error('Windows Cua SDK integrity mismatch.');
  const nativeArchive = join(stage, 'cua.tgz'),
    native = join(stage, 'native');
  await writeFile(nativeArchive, bytes);
  await mkdir(native);
  const tar = process.platform === 'win32' ? 'tar.exe' : '/usr/bin/tar';
  const entries = run(tar, ['-tzf', nativeArchive]).toString().trim().split('\n');
  if (entries.some((name) => !/^package\/[^/]+$/.test(name) || name.includes('..')))
    throw Error('Unexpected Cua package contents.');
  run(tar, ['-xzf', nativeArchive, '-C', native]);
  await packageCua(root, application, 'x64', 'win32', join(native, 'package'));
  await writeFile(
    join(application, 'package.json'),
    JSON.stringify(
      {
        name: metadata.name,
        version: metadata.version,
        description: metadata.description,
        main: metadata.main,
      },
      null,
      2,
    ) + '\n',
  );
  await cp(join(root, 'technical-spec/WINDOWS.md'), join(bundle, 'WINDOWS.md'));
  await writeFile(
    join(bundle, 'BUILD.json'),
    JSON.stringify(
      {
        version: metadata.version,
        target: 'win32-x64',
        electron: electronVersion,
        electronArchiveSha256: electronSha256,
        cua: '0.49.11',
        nativeWindowsAcceptance: false,
        codeSigned: false,
      },
      null,
      2,
    ) + '\n',
  );
  const files = await readdir(join(application, 'node_modules/@trycua/cua-driver-win32-x64-msvc'));
  if (!files.some((name) => name.endsWith('.dll')) || !files.some((name) => name.endsWith('.node')))
    throw Error('Missing Windows native runtime.');
  const output = join(root, 'dist', `Pi-Studio-${metadata.version}-win-x64.zip`);
  await mkdir(join(root, 'dist'), { recursive: true });
  await rm(output, { force: true });
  if (process.platform === 'win32')
    run(
      'powershell.exe',
      ps(
        `Compress-Archive -LiteralPath ${literal(bundle)} -DestinationPath ${literal(output)} -CompressionLevel Optimal`,
      ),
    );
  else run('/usr/bin/ditto', ['-c', '-k', '--norsrc', '--noextattr', '--keepParent', bundle, output]);
  const digest = createHash('sha256')
    .update(await readFile(output))
    .digest('hex');
  await writeFile(output + '.sha256', `${digest}  ${output.split(/[\\/]/).at(-1)}\n`);
  for (const file of await readdir(join(root, 'dist')))
    if (
      /^Pi-Studio-.*-win-x64\.zip(?:\.sha256)?$/.test(file) &&
      !file.startsWith(`Pi-Studio-${metadata.version}-`)
    )
      await rm(join(root, 'dist', file));
  console.log(
    `Windows x64 preview: ${output}\nSHA-256: ${digest}\nCross-built; native Windows acceptance is pending. Not Authenticode signed.`,
  );
} finally {
  await rm(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
