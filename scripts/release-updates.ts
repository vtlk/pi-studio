/** Offline release signing. No GitHub token/network access; private key stays outside the repository. */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
} from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectUpdateArchive } from '../src/main/updates/archive.ts';
import {
  archiveName,
  manifestName,
  validateManifest,
  verifyManifest,
} from '../src/main/updates/manifest.ts';
import type { UpdatePlatform } from '../src/shared/updates.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicFile = join(root, 'src/main/updates/publicKey.json');
const [operation, ...args] = process.argv.slice(2);
const privateFile = operation === 'init' ? args[0] : process.env.PI_STUDIO_UPDATE_SIGNING_KEY;
if (!privateFile || !isAbsolute(privateFile))
  throw new Error(
    'Use an absolute private-key path outside the repository; sign uses PI_STUDIO_UPDATE_SIGNING_KEY.',
  );
await mkdir(dirname(privateFile), { recursive: true, mode: 0o700 });
const parent = await realpath(dirname(privateFile));
if (!relative(root, parent).startsWith('..'))
  throw new Error('Private release key must stay outside the repository.');
if (operation === 'init') {
  if (args.length !== 1)
    throw new Error('Usage: release-updates.ts init /absolute/private-key.pem');
  const pair = generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ format: 'pem', type: 'spki' }).toString();
  // Refuse overwrites of both identities; never silently rotate the key trusted by installed apps.
  try {
    await lstat(publicFile);
    throw new Error(
      'Public update identity already exists; rotation requires an explicit migration.',
    );
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
      throw error;
  }
  await writeFile(privateFile, pair.privateKey.export({ format: 'pem', type: 'pkcs8' }), {
    flag: 'wx',
    mode: 0o600,
  });
  await writeFile(
    publicFile,
    JSON.stringify({ algorithm: 'Ed25519', spki: publicKey }, null, 2) + '\n',
    { flag: 'wx' },
  );
  console.log(
    'Created the external private key and pinned public update identity. No private key was printed.',
  );
} else if (operation === 'sign') {
  const [archive, platform, arch, minOs, sourceCommit] = args;
  if (args.length !== 5 || !archive || !['darwin', 'win32'].includes(platform))
    throw new Error(
      'Usage: release-updates.ts sign archive.zip darwin|win32 arm64|x64 minOs sourceCommit',
    );
  const keyStat = await lstat(privateFile);
  if (
    !keyStat.isFile() ||
    keyStat.isSymbolicLink() ||
    (process.platform !== 'win32' && keyStat.mode & 0o077)
  )
    throw new Error('Private update key must be a regular restricted file (0600).');
  const privateKey = createPrivateKey(await readFile(privateFile));
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  const pinned = JSON.parse(await readFile(publicFile, 'utf8'));
  if (pinned.algorithm !== 'Ed25519' || pinned.spki !== publicKey)
    throw new Error('Signing key does not match the pinned application identity.');
  const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
  if (basename(archive) !== archiveName(version, platform as UpdatePlatform, arch))
    throw new Error('Archive name/version does not match this checkout.');
  const before = await stat(archive);
  const inspected = await inspectUpdateArchive(archive, platform as UpdatePlatform);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  const after = await stat(archive);
  if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
    throw new Error('Archive changed during signing.');
  const payload = Buffer.from(
    JSON.stringify(
      validateManifest({
        schema: 1,
        appId: 'studio.pi.desktop',
        version,
        platform,
        arch,
        minOs,
        sourceCommit,
        format: platform === 'darwin' ? 'mac-zip' : 'windows-portable-zip',
        archive: {
          name: basename(archive),
          bytes: before.size,
          unpackedBytes: inspected.unpackedBytes,
          sha256: hash.digest('hex'),
        },
      }),
    ),
  );
  const envelope = Buffer.from(
    JSON.stringify({
      payload: payload.toString('base64'),
      signature: sign(null, payload, privateKey).toString('base64'),
    }) + '\n',
  );
  verifyManifest(envelope, publicKey);
  const output = join(dirname(archive), manifestName(version, platform as UpdatePlatform, arch));
  await writeFile(output, envelope, { flag: 'wx', mode: 0o644 });
  console.log(`Signed update metadata: ${output}`);
} else throw new Error('Supported operations: init, sign.');
