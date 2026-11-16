import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeEnvironment } from '../bundled/pi-bridge/claude-code/environment.mjs';
import { claudeStatus } from '../bundled/pi-bridge/claude-code/status.mjs';
import {
  withClaudeExtension,
  bundledClaudeExtension,
} from '../bundled/pi-bridge/claude-code/extensions.mjs';
import { verifyClaudePackage } from '../scripts/verify-claude-package.mjs';
import { openClaudeCodeAction } from '../src/main/pi/claudeCode.ts';
import { connectionAuthScope } from '../src/main/pi/modelAuth.ts';

test('Claude route rejects backend/credential/paid override and removes inherited API key', () => {
  for (const key of [
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_FOUNDRY',
    'PI_CLAUDE_CODE_ALLOW_USAGE_CREDITS',
  ])
    assert.throws(() => claudeEnvironment({ [key]: '1' }));
  assert.equal(claudeEnvironment({ ANTHROPIC_API_KEY: 'must-drop' }).ANTHROPIC_API_KEY, undefined);
  assert.equal(claudeEnvironment({}).PI_CLAUDE_CODE_ALLOW_USAGE_CREDITS, '0');
});

test('Claude pinned source integrity and exactly one built-in native provider extension', async (t) => {
  const source = fileURLToPath(new URL('../bundled/pi-claude-code', import.meta.url));
  assert.equal((await verifyClaudePackage(source)).runtimePeers['@earendil-works/pi-ai'], '1.5.2');
  const original = join(source, 'src/index.ts');
  assert.deepEqual(await withClaudeExtension([original, bundledClaudeExtension, original]), [
    bundledClaudeExtension,
  ]);
  const root = await mkdtemp(join(tmpdir(), 'pistudio-claude-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(source, root, { recursive: true });
  await writeFile(join(root, 'src/provider.ts'), 'changed');
  await assert.rejects(verifyClaudePackage(root), /integrity mismatch/);
});

test('Claude CLI auth exposes safe status only and version/auth errors never masquerade as ready', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-claude-status-'));
  const previous = { ...process.env };
  t.after(async () => {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    await rm(root, { recursive: true, force: true });
  });
  for (const key of [
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_FOUNDRY_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_FOUNDRY',
    'PI_CLAUDE_CODE_ALLOW_USAGE_CREDITS',
  ])
    delete process.env[key];
  const cli = join(root, 'claude');
  process.env.PI_CLAUDE_CODE_COMMAND = cli;
  await writeFile(
    cli,
    '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "2.1.300 (Claude Code)"; elif [ "$1" = "--help" ]; then echo "--input-format --output-format --system-prompt-file --strict-mcp-config --no-session-persistence --permission-prompts"; else echo \'{"loggedIn":true,"subscriptionType":"max","authMethod":"claude.ai","secret":"NEVER_FORWARD"}\'; fi\n',
    { mode: 0o700 },
  );
  assert.equal((await claudeStatus()).status, 'ready');
  assert.doesNotMatch(JSON.stringify(await claudeStatus()), /NEVER_FORWARD/);
  await writeFile(cli, '#!/bin/sh\necho "NEVER_FORWARD"\n');
  assert.equal((await claudeStatus()).status, 'invalid');
  assert.doesNotMatch(JSON.stringify(await claudeStatus()), /NEVER_FORWARD/);
  process.env.PI_CLAUDE_CODE_COMMAND = join(root, 'absent');
  assert.equal((await claudeStatus()).status, 'not_ready');
});

test('Claude login/install are fixed explicit official commands and cannot claim isolated credentials', async () => {
  let command = '';
  const open = async (value) => {
    command = value;
  };
  await openClaudeCodeAction(
    'login',
    { command: '/tmp/Claude app/claude', status: 'not_ready' },
    "/tmp/studio's files",
    open,
  );
  assert.match(command, /auth login$/);
  assert.match(command, /env -u ANTHROPIC_API_KEY/);
  assert.doesNotMatch(command, /--console/);
  await openClaudeCodeAction('install', { status: 'not_ready' }, '/tmp', open);
  assert.match(command, /^curl -fsSL https:\/\/claude.ai\/install.sh/);
  await assert.rejects(openClaudeCodeAction('login', { status: 'not_ready' }, '/tmp', open));
  const connection = {
    id: 'qa-claude',
    name: 'Claude',
    purpose: 'pi' as const,
    providerId: 'claude-code',
    endpoint: '',
    account: '',
    createdAt: 1,
  };
  assert.equal(
    await connectionAuthScope('/unused', '/unused', { ...connection, authScope: 'native' }),
    undefined,
  );
  await assert.rejects(
    connectionAuthScope('/unused', '/unused', { ...connection, authScope: 'connection' }),
    /общий вход/,
  );
});
