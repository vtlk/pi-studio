import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { bundledNotices } from '../scripts/bundled-notices.ts';
import {
  verifyBundledNotices,
  type BundledNoticeManifest,
} from '../scripts/audit/bundledNotices.ts';

async function collect(
  extra: { name: string; version: string; text?: string; notices?: string }[] = [],
  supplemental?: Buffer,
) {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-notices-test-'));
  try {
    const modules: string[] = [];
    for (const pkg of [
      { name: 'vite', version: '1.0.0', text: 'MIT\nCopyright Vite fixture\n' },
      { name: 'fixture-a', version: '1.2.3', text: 'MIT\nCopyright Фикстура — ©\n' },
      { name: '@fixture/b', version: '2.3.4', text: 'MIT\nCopyright Фикстура — ©\n' },
      ...extra,
    ]) {
      const directory = join(root, 'node_modules', pkg.name);
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, 'package.json'),
        JSON.stringify({
          name: pkg.name,
          version: pkg.version,
          license: 'MIT',
        }),
      );
      if (pkg.text !== undefined) await writeFile(join(directory, 'LICENSE'), pkg.text);
      if ('notices' in pkg && typeof pkg.notices === 'string')
        await writeFile(join(directory, 'ThirdPartyNotices.txt'), pkg.notices);
      modules.push(join(directory, 'index.js'));
    }
    await mkdir(join(root, 'third-party-licenses'));
    await writeFile(join(root, 'third-party-licenses/SOURCES.md'), 'Fixture provenance');
    if (supplemental)
      await writeFile(
        join(root, 'third-party-licenses/React-remove-scroll-bar-LICENSE.txt'),
        supplemental,
      );
    const emitted = new Map<string, string>();
    const context = {
      getModuleIds: () => modules.values(),
      emitFile: (asset: { fileName: string; source: string }) =>
        emitted.set(asset.fileName, asset.source),
    };
    const hook = bundledNotices(root).generateBundle as unknown as (
      this: typeof context,
    ) => Promise<void>;
    await hook.call(context);
    return {
      bytes: Buffer.from(emitted.get('THIRD_PARTY_NOTICES.txt')!),
      manifest: JSON.parse(emitted.get('third-party-packages.json')!) as BundledNoticeManifest,
      provenance: emitted.get('third-party-license-sources.md'),
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('actual collector binds full Unicode notice bytes to every package and deduplicates shared licenses', async () => {
  const { bytes, manifest, provenance } = await collect();
  assert.equal(manifest.schema, 2);
  assert.equal(manifest.packages.length, 3);
  assert.equal(manifest.notices.length, 2);
  assert.equal(provenance, 'Fixture provenance');
  assert.equal(verifyBundledNotices(bytes, manifest), manifest);
  const shared = manifest.notices.find((item) => item.packages.length === 2)!;
  assert.deepEqual(shared.packages, ['@fixture/b@2.3.4', 'fixture-a@1.2.3']);
  assert.equal(
    bytes.subarray(shared.byteOffset, shared.byteOffset + shared.byteLength).toString(),
    'MIT\nCopyright Фикстура — ©\n',
  );
});

test('notice verification rejects removed, modified and truncated texts even with intact package hash arrays', async () => {
  const { bytes, manifest } = await collect();
  assert.throws(() => verifyBundledNotices(Buffer.alloc(0), manifest));
  assert.throws(() => verifyBundledNotices(bytes.subarray(0, bytes.length - 5), manifest));
  const changed = Buffer.from(bytes);
  changed[manifest.notices[0].byteOffset] ^= 1;
  assert.throws(() => verifyBundledNotices(changed, manifest));
  assert.throws(() => verifyBundledNotices(bytes, { schema: 1, packages: manifest.packages }));
});

test('notice verification rejects broken package bindings, overlap, bad offsets and labels', async () => {
  const { bytes, manifest } = await collect();
  for (const mutate of [
    (m: BundledNoticeManifest) => {
      m.packages[0].noticeHashes = ['a'.repeat(64)];
    },
    (m: BundledNoticeManifest) => {
      m.packages.push(m.packages[0]);
    },
    (m: BundledNoticeManifest) => {
      m.notices.pop();
    },
    (m: BundledNoticeManifest) => {
      m.notices.push(m.notices[0]);
    },
    (m: BundledNoticeManifest) => {
      m.notices[1].byteOffset = m.notices[0].byteOffset;
    },
    (m: BundledNoticeManifest) => {
      m.notices[0].byteOffset = Number.MAX_SAFE_INTEGER;
    },
    (m: BundledNoticeManifest) => {
      m.notices[0].byteLength = -1;
    },
    (m: BundledNoticeManifest) => {
      m.notices[0].packages = ['foreign@1.0.0'];
    },
    (m: BundledNoticeManifest) => {
      m.notices[0].files = ['Other-LICENSE'];
    },
    (m: BundledNoticeManifest) => {
      m.notices[0].files = ['LICENSE\nInjected'];
    },
  ]) {
    const clone = structuredClone(manifest);
    mutate(clone);
    assert.throws(() => verifyBundledNotices(bytes, clone));
  }
});

test('collector fails a package with declared MIT but no full notice', async () => {
  await assert.rejects(
    collect([{ name: 'missing-license', version: '1.0.0' }]),
    /No full license text/,
  );
  await assert.rejects(
    collect([{ name: 'empty-license', version: '1.0.0', text: '' }]),
    /No full license text/,
  );
});

test('collector accepts the pinned supplemental notice and rejects changes to it', async () => {
  const supplemental = await readFile(
    new URL('../third-party-licenses/React-remove-scroll-bar-LICENSE.txt', import.meta.url),
  );
  assert.equal(
    createHash('sha256').update(supplemental).digest('hex'),
    'a79aae0c0f21990d9d963bb3c5a79cdcea9a46f8523ba55c58d7fe776b6ebc84',
  );
  const pkg = { name: 'react-remove-scroll-bar', version: '2.3.8' };
  const valid = await collect([pkg], supplemental);
  assert.equal(verifyBundledNotices(valid.bytes, valid.manifest).packages.length, 4);
  await assert.rejects(
    collect([pkg], Buffer.concat([supplemental, Buffer.from('Changed')])),
    /Supplemental license changed/,
  );
});

test('collector preserves upstream ThirdPartyNotices alongside the package license', async () => {
  const { bytes, manifest } = await collect([
    {
      name: 'editor-fixture',
      version: '1.0.0',
      text: 'MIT editor fixture',
      notices: 'Unmodified upstream third-party copyright',
    },
  ]);
  assert.ok(bytes.includes(Buffer.from('Unmodified upstream third-party copyright')));
  assert.equal(
    manifest.packages.find((pkg) => pkg.name === 'editor-fixture')?.noticeHashes.length,
    2,
  );
  verifyBundledNotices(bytes, manifest);
});
