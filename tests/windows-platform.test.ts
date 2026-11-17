import test from 'node:test';
import { i18n } from '../src/shared/i18n/index.ts';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, copyFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { managedPiPath, piEnvironment } from '../src/main/pi/platform.ts';
import { powershellArguments, powershellLiteral } from '../src/main/pi/windowsShell.ts';
import { windowsFileName } from '../src/shared/windowsNames.ts';
import { folderSlug } from '../src/shared/folderSlug.ts';
import { portableMcp } from '../src/main/teams/portableMcp.ts';
import { packagePath } from '../src/main/teams/packageCodec.ts';
import { browserArchive, chromeArchive } from '../src/main/browser/browserVersions.ts';
import { RunChannel } from '../src/main/pi/RunChannel.ts';
import type { SessionEnvelope } from '../src/main/pi/RunChannel.ts';
import { claudeEnvironment } from '../bundled/pi-bridge/claude-code/environment.mjs';

test('Windows CLI shims are resolved as files and run with Node, never executed by a shell', async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-win-Проверка $ ' &-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const platform = process.platform;
  const cli = managedPiPath(root, 'win32');
  const directory = join(root, 'package/node_modules/@earendil-works/pi-coding-agent/dist/bundle');
  await mkdir(directory, { recursive: true });
  await mkdir(join(root, 'node'));
  const node = join(root, 'node/node.exe');
  if (platform === 'win32') await copyFile(process.execPath, node);
  else await symlink(process.execPath, node);
  const shim = join(root, 'package/pi.cmd');
  await writeFile(shim, 'THIS MUST NEVER EXECUTE');
  await writeFile(
    cli,
    `console.log(process.argv.includes('--version') ? '1.5.2' : 'pi mcp --session <path|id> --fork <path|id>');`,
  );
  Object.defineProperty(process, 'platform', { value: 'win32' });
  try {
    const checked = await checkPi(shim);
    assert.equal(checked.path, cli);
    assert.equal(checked.supported && checked.nativeMcp && checked.exactSessions, true);
    assert.equal(await readFile(shim, 'utf8'), 'THIS MUST NEVER EXECUTE');
  } finally {
    Object.defineProperty(process, 'platform', { value: platform });
  }
});

test('cross-platform team packets require explicit mapping of Windows and POSIX commands/paths', () => {
  for (const path of [
    'C:\\Program Files\\Tool\\tool.exe',
    'C:/Tools/tool.exe',
    'C:tool.exe',
    '\\\\server\\share\\tool.exe',
    '/opt/tools/server',
  ]) {
    const result = portableMcp({ command: path, args: [path] });
    assert.equal(result.requirements.length, 2);
    assert.deepEqual(result.config, { command: path, args: [path] });
  }
  assert.deepEqual(portableMcp({ command: 'node', args: ['server.js'] }).requirements, []);
  for (const name of [
    'CON',
    'nul.txt',
    'COM1',
    'lpt³.txt',
    'x:secret',
    'trailing.',
    'trailing ',
    'x*y',
    '..',
  ]) {
    assert.equal(windowsFileName(name), false);
    assert.throws(() => packagePath(`resources/resource-1/files/${name}`));
  }
  assert.equal(windowsFileName('Сценарий.md'), true);
  assert.equal(folderSlug('CON'), '_con');
  assert.equal(folderSlug('Мой проект'), 'moy-proekt');
});

test('PowerShell transports literal paths as encoded data and PATH has no case-duplicate keys', () => {
  const path = "C:\\Моя папка\\O'Brien $x; & foo\\";
  assert.equal(powershellLiteral(path), "'C:\\Моя папка\\O''Brien $x; & foo\\'");
  const script = `& ${powershellLiteral(path)} '--literal'`;
  const args = powershellArguments(script);
  assert.equal(
    Buffer.from(args.at(-1)!, 'base64').toString('utf16le'),
    `$ErrorActionPreference = 'Stop'; ${script}`,
  );
  const env = piEnvironment('private-node', { Path: 'one', PATH: 'two', KEEP: 'same' });
  assert.deepEqual(
    Object.keys(env).filter((key) => key.toLowerCase() === 'path'),
    ['PATH'],
  );
  assert.deepEqual(env.PATH.split(delimiter).slice(0, 3), ['private-node', 'one', 'two']);
  assert.equal(env.KEEP, 'same');
  assert.match(browserArchive('x64', 'win32').url, /cli-win32-x64-msvc/);
  assert.equal(chromeArchive('x64', 'win32').folder, 'chrome-headless-shell-win64');
  assert.throws(() => browserArchive('arm64', 'win32'));
});

test('Windows case-insensitive auth variables cannot bypass the subscription guard', () => {
  const platform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'win32' });
  try {
    const env = claudeEnvironment({ Path: 'native-tools', anthropic_api_key: 'must-be-stripped' });
    assert.equal(
      Object.keys(env).some((key) => key.toUpperCase() === 'ANTHROPIC_API_KEY'),
      false,
    );
    assert.equal(env.PATH.split(delimiter)[0], 'native-tools');
    assert.equal('Path' in env, false);
    assert.throws(() => claudeEnvironment({ claude_code_use_bedrock: '1' }), /другого способа/);
    assert.throws(
      () => claudeEnvironment({ anthropic_auth_token: 'do-not-forward' }),
      /другого способа/,
    );
    assert.throws(
      () => claudeEnvironment({ Path: 'first', PATH: 'conflicting' }),
      /противоречивые/,
    );
  } finally {
    Object.defineProperty(process, 'platform', { value: platform });
  }
});

test('graceful bridge shutdown remains session-scoped and authenticated, with no user message', async (t) => {
  const channel = new RunChannel();
  t.after(() => channel.close());
  const events: string[] = [];
  const envelope = { resources: { mcpServers: [] } } as unknown as SessionEnvelope;
  const first = await channel.add(
    'one',
    envelope,
    async (event) => {
      events.push(event.type);
    },
    async () => ({}),
  );
  const second = await channel.add(
    'two',
    envelope,
    async () => {},
    async () => ({}),
  );
  channel.stop('one');
  const heartbeat = async (transport: typeof first, token = transport.token) =>
    fetch(transport.url + '/event', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'heartbeat' }),
    });
  assert.equal((await heartbeat(first, second.token)).status, 403);
  assert.deepEqual(await (await heartbeat(first)).json(), {
    ok: true,
    language: i18n.language,
    stop: true,
  });
  assert.deepEqual(await (await heartbeat(second)).json(), { ok: true, language: i18n.language });
  assert.deepEqual(events, ['heartbeat']);
});
