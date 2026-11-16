import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOsVersion, compatible } from '../src/main/updates/releasePolicy.ts';

test('native OS version normalization retains minimum-version comparisons for patchless macOS and Windows revisions', () => {
  assert.equal(normalizeOsVersion('13.0'), '13.0.0');
  assert.equal(normalizeOsVersion('27'), '27.0.0');
  assert.equal(normalizeOsVersion('27.0.1'), '27.0.1');
  assert.equal(normalizeOsVersion('10.0.26100.1'), '10.0.26100');
  for (const value of ['27.beta', 'v27.1', '27.1 (build)', '1.2.3.4.5', ''])
    assert.throws(() => normalizeOsVersion(value));
  const manifest = {
    platform: 'darwin',
    arch: 'arm64',
    version: '0.2.0-alpha.77',
    minOs: '13.0.0',
  } as never;
  assert.equal(
    compatible(
      {
        version: '0.2.0-alpha.76',
        platform: 'darwin',
        arch: 'arm64',
        osVersion: normalizeOsVersion('13.0'),
      },
      manifest,
    ),
    true,
  );
  assert.equal(
    compatible(
      {
        version: '0.2.0-alpha.76',
        platform: 'darwin',
        arch: 'arm64',
        osVersion: normalizeOsVersion('12.7'),
      },
      manifest,
    ),
    false,
  );
});
