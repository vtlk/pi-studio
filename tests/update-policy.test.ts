import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { newerInChannel, compatible } from '../src/main/updates/releasePolicy.ts';
import { validateManifest, verifyManifest, archiveName } from '../src/main/updates/manifest.ts';
import { checkGitHubReleases } from '../src/main/updates/githubReleases.ts';
import {
  boundedBody,
  githubResponse,
  releaseApi,
  releaseAssetUrl,
  UpdateNetworkError,
} from '../src/main/updates/githubTransport.ts';
import type { UpdateManifest } from '../src/shared/updates.ts';

const pair = generateKeyPairSync('ed25519');
const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const signal = new AbortController().signal;
const target = {
  version: '0.2.0-alpha.75',
  platform: 'darwin' as const,
  arch: 'arm64',
  osVersion: '15.1.0',
};
function manifest(version = '0.2.0-alpha.76'): UpdateManifest {
  return {
    schema: 1,
    appId: 'studio.pi.desktop',
    version,
    platform: 'darwin',
    arch: 'arm64',
    minOs: '13.0.0',
    format: 'mac-zip',
    sourceCommit: 'a'.repeat(40),
    archive: {
      name: archiveName(version, 'darwin', 'arm64'),
      sha256: 'b'.repeat(64),
      bytes: 100,
      unpackedBytes: 200,
    },
  };
}
function envelope(value: unknown, key = pair.privateKey) {
  const payload = Buffer.from(JSON.stringify(value));
  return Buffer.from(
    JSON.stringify({
      payload: payload.toString('base64'),
      signature: sign(null, payload, key).toString('base64'),
    }),
  );
}
function release(value: UpdateManifest) {
  const bytes = envelope(value);
  return {
    draft: false,
    prerelease: !!value.version.includes('-'),
    tag_name: 'v' + value.version,
    body: 'Plain release notes',
    assets: [
      { name: `Pi-Studio-${value.version}-darwin-arm64.update.json`, size: bytes.length },
      {
        name: value.archive.name,
        size: value.archive.bytes,
        digest: 'sha256:' + value.archive.sha256,
      },
    ],
  };
}

test('update channels use numeric SemVer, never downgrade or silently change prerelease channel', () => {
  for (const [from, to, expected] of [
    ['0.2.0-alpha.9', '0.2.0-alpha.10', true],
    ['0.2.0-alpha.75', '0.2.0', true],
    ['0.2.0', '0.3.0-alpha.1', false],
    ['0.2.0-alpha.75', '0.3.0-beta.1', false],
    ['0.2.0-alpha.75', '0.2.0-alpha.75', false],
    ['0.2.0', '0.1.99', false],
    ['0.2.0', '0.2.1', true],
    ['invalid', '1.0.0', false],
  ] as const)
    assert.equal(newerInChannel(from, to), expected, `${from} -> ${to}`);
  assert.equal(compatible(target, manifest()), true);
  assert.equal(compatible({ ...target, arch: 'x64' }, manifest()), false);
  assert.equal(compatible({ ...target, osVersion: '12.9.0' }, manifest()), false);
  assert.equal(compatible({ ...target, platform: 'win32' }, manifest()), false);
});

test('only pinned Ed25519 bytes authorize exact package/version/platform metadata', () => {
  assert.deepEqual(verifyManifest(envelope(manifest()), publicKey), manifest());
  const forged = envelope(manifest(), generateKeyPairSync('ed25519').privateKey);
  assert.throws(() => verifyManifest(forged, publicKey), /Подпись/);
  const tampered = JSON.parse(envelope(manifest()).toString());
  tampered.payload = Buffer.from(JSON.stringify({ ...manifest(), version: '99.0.0' })).toString(
    'base64',
  );
  assert.throws(() => verifyManifest(Buffer.from(JSON.stringify(tampered)), publicKey), /Подпись/);
  for (const bad of [
    { ...manifest(), url: 'https://untrusted.invalid/' },
    { ...manifest(), sourceCommit: 'main' },
    { ...manifest(), appId: 'another.application' },
    { ...manifest(), version: '0.2.0+other' },
    { ...manifest(), arch: 'x86' },
    { ...manifest(), minOs: '../13' },
    { ...manifest(), archive: { ...manifest().archive, bytes: 2 ** 40 } },
    { ...manifest(), archive: { ...manifest().archive, name: '../package.zip' } },
    { ...manifest(), archive: { ...manifest().archive, sha256: 'b'.repeat(63) } },
  ])
    assert.throws(() => verifyManifest(envelope(bad), publicKey));
  assert.throws(() => verifyManifest(Buffer.alloc(33 * 1024), publicKey));
  assert.throws(() => validateManifest(null));
});

test('GitHub chooses the newest compatible published signed package, not newest tag/API order', async () => {
  const compatibleOld = manifest('0.2.0-alpha.76'),
    compatibleNew = manifest('0.2.0-alpha.80');
  const incompatible = { ...manifest('0.2.0-alpha.81'), minOs: '99.0.0' };
  const values = [
    release(compatibleOld),
    release(incompatible),
    { ...release(manifest('0.2.0-alpha.99')), assets: [] },
    release(compatibleNew),
    { ...release(manifest('0.2.0-alpha.90')), draft: true },
    release(manifest('0.3.0-beta.1')),
  ];
  const calls: string[] = [];
  const request: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    assert.equal(init?.credentials, 'omit');
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    if (url.startsWith(releaseApi)) return Response.json(values);
    const match = [compatibleOld, compatibleNew, incompatible].find((value) =>
      url.includes(value.version),
    );
    assert.ok(match);
    return new Response(envelope(match));
  };
  const result = await checkGitHubReleases({ target, publicKey, signal, fetch: request });
  assert.equal(result?.manifest.version, '0.2.0-alpha.80');
  assert.equal(result?.archiveUrl, releaseAssetUrl('v0.2.0-alpha.80', compatibleNew.archive.name));
  assert.equal(calls.length, 3); // API + incompatible minimum OS + actual candidate; no ZIP downloaded.
  assert.equal(
    calls.some((url) => url.endsWith('.zip')),
    false,
  );
});

test('missing assets, incompatible OS, digest mismatch, tampering and revoked release never authorize installation', async () => {
  const value = manifest(),
    item = release(value);
  for (const assets of [[], [item.assets[0]]]) {
    const request: typeof fetch = async (url) =>
      String(url).startsWith(releaseApi)
        ? Response.json([{ ...item, assets }])
        : new Response(envelope(value));
    assert.equal(
      await checkGitHubReleases({ target, publicKey, signal, fetch: request }),
      undefined,
    );
  }
  const badDigest = {
    ...item,
    assets: [item.assets[0], { ...item.assets[1], digest: 'sha256:' + 'c'.repeat(64) }],
  };
  await assert.rejects(
    checkGitHubReleases({
      target,
      publicKey,
      signal,
      fetch: async (url) =>
        String(url).startsWith(releaseApi)
          ? Response.json([badDigest])
          : new Response(envelope(value)),
    }),
    /подписанным/,
  );
  await assert.rejects(
    checkGitHubReleases({
      target,
      publicKey,
      signal,
      fetch: async () => new Response('', { status: 404 }),
    }),
    /закрыт/,
  );
});

test('anonymous download redirects are HTTPS and GitHub-only; bounds/cancellation/rate limit survive network faults', async () => {
  const address = releaseAssetUrl('v0.2.0-alpha.76', 'package.zip');
  for (const location of [
    'http://github.com/vtlk/pi-studio/releases/download/a',
    'https://attacker.invalid/asset',
    'https://github.com/someone/else/package.zip',
    'https://user:password@release-assets.githubusercontent.com/a',
  ]) {
    let calls = 0;
    await assert.rejects(
      githubResponse(address, signal, async () => {
        calls++;
        return new Response(null, { status: 302, headers: { location } });
      }),
      /разрешён/,
    );
    assert.equal(calls, 1);
  }
  let calls = 0;
  const response = await githubResponse(address, signal, async () =>
    ++calls === 1
      ? new Response(null, {
          status: 302,
          headers: { location: 'https://release-assets.githubusercontent.com/asset?download=1' },
        })
      : new Response('zip'),
  );
  assert.equal(await response.text(), 'zip');
  assert.equal(calls, 2);
  await assert.rejects(
    githubResponse(
      address,
      signal,
      async () => new Response(null, { status: 302, headers: { location: address } }),
    ),
    /перенаправление/,
  );
  await assert.rejects(boundedBody(new Response('too large'), 2), /размер/);
  await assert.rejects(
    githubResponse(address, signal, async () => {
      throw new Error('offline');
    }),
    /offline/,
  );
  await assert.rejects(
    githubResponse(
      address,
      signal,
      async () => new Response(null, { status: 429, headers: { 'retry-after': '600' } }),
      1000,
    ),
    (error: unknown) => error instanceof UpdateNetworkError && error.retryAt === 601000,
  );
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    githubResponse(address, cancelled.signal, async () => {
      throw new Error('must not fetch');
    }),
    /abort/i,
  );
});
