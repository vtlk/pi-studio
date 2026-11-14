import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, rm, mkdir, symlink, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  componentHash,
  componentState,
  downloadBrowserComponent,
  publishBrowserComponent,
} from '../src/main/browser/componentFiles.ts';
import { browserArchive, chromeArchive } from '../src/main/browser/browserVersions.ts';
import { reservedMcpName } from '../src/shared/builtinResources.ts';
import { validateBrowserCall } from '../bundled/pi-bridge/browser/tools.mjs';
import { privatePath, saveDownload, regularFile } from '../bundled/pi-bridge/browser/files.mjs';
import { BrowserSession } from '../bundled/pi-bridge/browser/BrowserSession.mjs';

test('Browser tools reject per-call session/config/CLI scope escapes and nonfinite coordinates', () => {
  for (const extra of ['session', 'namespace', 'extraArgs', 'profile', 'config', 'restore', 'cdp'])
    assert.throws(() =>
      validateBrowserCall('browser_open', { url: 'https://example.com', [extra]: 'foreign' }),
    );
  for (const x of [-1, 1280, Infinity, NaN, '100'])
    assert.throws(() => validateBrowserCall('browser_click', { x, y: 20 }));
  assert.throws(() => validateBrowserCall('browser_install', {}));
  assert.throws(() =>
    validateBrowserCall('browser_upload', { ref: 'input[type=file]', files: ['a'] }),
  );
  assert.deepEqual(validateBrowserCall('browser_click', { x: 12, y: 25 }), { x: 12, y: 25 });
  for (const name of ['pi_studio', 'pi-studio-browser', 'pi_studio_computer'])
    assert.equal(reservedMcpName(name), true);
  assert.equal(reservedMcpName('custom'), false);
});

test('Browser profile scope is canonical-dialogue specific; status never launches missing components', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-browser-unit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const binding = {
    scope: 'studio/project/agent',
    sessions: root,
    visual: true,
    binary: join(root, 'missing'),
    chrome: join(root, 'missing-chrome'),
  };
  const a = new BrowserSession(binding, 'canonical-a'),
    same = new BrowserSession(binding, 'canonical-a');
  const other = new BrowserSession(binding, 'canonical-b'),
    clone = new BrowserSession({ ...binding, scope: 'clone' }, 'canonical-a');
  assert.equal(a.root, same.root);
  assert.notEqual(a.root, other.root);
  assert.notEqual(a.root, clone.root);
  const status = await a.call('browser_status', {});
  assert.match(status.content[0].text, /не установлены/);
  assert.deepEqual(await readdir(root), []);
  await assert.rejects(a.call('browser_open', { url: 'https://example.com' }), /не установлены/);
  const textModel = new BrowserSession({ ...binding, visual: false }, 'text');
  await assert.rejects(textModel.call('browser_screenshot', {}), /не принимает изображения/);
});

test('Browser downloads stay within own output, reject symlinks/special files and never overwrite', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-browser-files-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const downloads = join(root, 'downloads'),
    output = join(root, 'output');
  await mkdir(downloads);
  await mkdir(output);
  await writeFile(join(downloads, 'result.txt'), 'result');
  await saveDownload(downloads, 'result.txt', output, 'sub/result.txt');
  assert.equal(await readFile(join(output, 'sub/result.txt'), 'utf8'), 'result');
  await assert.rejects(saveDownload(downloads, 'result.txt', output, 'sub/result.txt'), /EEXIST/);
  await assert.rejects(saveDownload(downloads, 'result.txt', output, '../escape'));
  await symlink(downloads, join(output, 'linked'));
  await assert.rejects(privatePath(output, 'linked/result.txt'), /Символические/);
  const fifo = join(downloads, 'pipe');
  execFileSync('/usr/bin/mkfifo', [fifo]);
  await assert.rejects(regularFile(fifo), /обычный файл/);
  assert.deepEqual(await readdir(join(output, 'sub')), ['result.txt']);
});

test(
  'Browser component integrity reads are bounded and reject FIFO/symlink without blocking',
  { timeout: 1000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'pistudio-browser-hash-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const path = join(root, 'component');
    await writeFile(path, 'abcd');
    assert.equal(await componentHash(path, 4), createHash('sha256').update('abcd').digest('hex'));
    await assert.rejects(componentHash(path, 3));
    const fifo = join(root, 'pipe');
    execFileSync('/usr/bin/mkfifo', [fifo]);
    await assert.rejects(componentHash(fifo, 100));
    await assert.rejects(componentState(fifo));
    await symlink(path, join(root, 'link'));
    await assert.rejects(componentHash(join(root, 'link'), 100));
  },
);

test('Browser component downloads require the pinned digest and byte limit before installation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-browser-download-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = Buffer.from('component'),
    hash = createHash('sha256').update(bytes).digest('hex');
  let calls = 0;
  const request = async (_url, options) => {
    calls++;
    assert.equal(options.redirect, 'error');
    return new Response(bytes);
  };
  const expected = { algorithm: 'sha256', encoding: 'hex', hash, maxBytes: 20 } as const;
  await downloadBrowserComponent(
    'https://fixture',
    join(root, 'ok'),
    AbortSignal.timeout(1000),
    expected,
    request as typeof fetch,
  );
  await assert.rejects(
    downloadBrowserComponent(
      'https://fixture',
      join(root, 'bad'),
      AbortSignal.timeout(1000),
      { ...expected, hash: 'bad' },
      request as typeof fetch,
    ),
    /сумма/,
  );
  await assert.rejects(
    downloadBrowserComponent(
      'https://fixture',
      join(root, 'large'),
      AbortSignal.timeout(1000),
      { ...expected, maxBytes: 2 },
      request as typeof fetch,
    ),
    /размер/,
  );
  assert.equal(calls, 3);
  assert.match(browserArchive('arm64').url, /0\.43\.0/);
  assert.match(chromeArchive('arm64').url, /157\.0\.8103\.78/);
  assert.throws(() => browserArchive('ia32'));
});

test('Browser component replacement repairs its own invalid cache and preserves a valid concurrent install', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-browser-publish-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, 'runtime'),
    stage = join(root, 'stage');
  await mkdir(target);
  await mkdir(stage);
  await writeFile(join(target, 'binary'), 'corrupt');
  await writeFile(join(stage, 'binary'), 'verified');
  const read = async (folder: string) =>
    (await readFile(join(folder, 'binary'), 'utf8')) === 'verified'
      ? join(folder, 'binary')
      : undefined;
  assert.equal(await publishBrowserComponent(stage, target, read), undefined);
  assert.equal(await readFile(join(target, 'binary'), 'utf8'), 'verified');
  await mkdir(stage);
  await writeFile(join(stage, 'binary'), 'another');
  assert.equal(await publishBrowserComponent(stage, target, read), join(target, 'binary'));
  await symlink(target, join(root, 'linked'));
  await assert.rejects(publishBrowserComponent(stage, join(root, 'linked'), read), /символической/);
});
