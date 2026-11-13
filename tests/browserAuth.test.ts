import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  validateCodexAuthUrl,
  validateMcpAuthUrl,
  resolvePiSdk,
} from '../src/main/pi/BrowserAuth.ts';

test('SDK discovery resolves the official bundled CLI layout and rejects other packages', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-sdk-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'dist/bundle'), { recursive: true });
  const metadata = join(root, 'package.json');
  await writeFile(
    metadata,
    JSON.stringify({ name: '@earendil-works/pi-coding-agent', version: '1.5.2' }),
  );
  assert.equal(await resolvePiSdk(join(root, 'dist/bundle/cli.js')), join(root, 'dist/index.js'));
  assert.equal(await resolvePiSdk(join(root, 'dist/cli.js')), join(root, 'dist/index.js'));
  await writeFile(metadata, JSON.stringify({ name: 'different-package', version: '1.5.2' }));
  await assert.rejects(resolvePiSdk(join(root, 'dist/bundle/cli.js')));
});

test('Codex login only opens native OpenAI HTTPS authentication URLs', () => {
  assert.equal(
    validateCodexAuthUrl('https://auth.openai.com/oauth/authorize?state=opaque'),
    'https://auth.openai.com/oauth/authorize?state=opaque',
  );
  for (const url of [
    'http://auth.openai.com/',
    'https://evil.example/',
    'https://auth.openai.com.evil.example/',
    'javascript:alert(1)',
    'https://user:secret@auth.openai.com/',
  ])
    assert.throws(() => validateCodexAuthUrl(url));
});
test('MCP OAuth permits discovered HTTPS providers and loopback, never credentials or non-web schemes', () => {
  for (const url of [
    'https://accounts.example/authorize?state=test',
    'http://127.0.0.1:12345/authorize',
    'http://localhost:12345/callback',
    'http://[::1]:12345/callback',
  ])
    assert.equal(validateMcpAuthUrl(url), url);
  for (const url of [
    'http://remote.example/authorize',
    'javascript:alert(1)',
    'file:///tmp/x',
    'https://user:secret@accounts.example/authorize',
    'https://accounts.example/\nredirect',
  ])
    assert.throws(() => validateMcpAuthUrl(url));
});
test('the Pi SDK bridge delegates login and emits no credentials or raw errors', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-auth-bridge-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sdk = join(root, 'sdk.mjs');
  await writeFile(
    sdk,
    `export const ModelRuntime = { async create(options) {
    if (options.allowModelNetwork !== false) throw new Error('must not generate');
    return { async login(provider, kind, interaction) {
      if (provider !== 'openai-codex' || kind !== 'oauth') throw new Error('wrong provider');
      const method = await interaction.prompt({type:'select', options:[{id:'browser'}]});
      if (method !== 'browser') throw new Error('wrong method');
      interaction.notify({type:'auth_url',url:'https://auth.openai.com/oauth/authorize?state=test'});
      return {access_token:'MUST_NOT_LEAVE_PI'};
    }, async settleCredentialWrites() {} };
  }};`,
  );
  const { stdout } = await promisify(execFile)(process.execPath, [
    resolve('bundled/pi-bridge/login.mjs'),
    sdk,
  ]);
  const events = stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    events.map((event) => event.type),
    ['auth_url', 'done'],
  );
  assert.equal(stdout.includes('MUST_NOT_LEAVE_PI'), false);
  await writeFile(
    sdk,
    `export const ModelRuntime = { create() { throw new Error('token=DO_NOT_LEAK'); } };`,
  );
  await promisify(execFile)(process.execPath, [resolve('bundled/pi-bridge/login.mjs'), sdk]).then(
    () => assert.fail('expected failure'),
    (error: { stdout: string }) => {
      assert.equal(error.stdout.trim(), '{"type":"failed"}');
      assert.equal(error.stdout.includes('DO_NOT_LEAK'), false);
    },
  );
});
