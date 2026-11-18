import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { nodeTools, withNodeCommand, npmSettings } from '../bundled/pi-bridge/node-tools.mjs';
import { sessionSystemPrompt } from '../bundled/pi-bridge/prompt.mjs';
import { nativeResourceOperation } from '../src/main/pi/NativeResources.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { changeLanguage } from '../src/shared/i18n/index.ts';
import { setupTools } from '../src/main/pi/setupTools.ts';
import { StudioService } from '../src/main/storage/StudioStore.ts';
import { StudioResources } from '../src/main/pi/StudioResources.ts';

const node = 'D:\\Pi Studio\\компоненты\\node\\node.exe';
const npm = 'D:\\Pi Studio\\компоненты\\node\\node_modules\\npm\\bin\\npm-cli.js';
const npx = npm.replace('npm-cli.js', 'npx-cli.js');

test('onboarding discovers npx in the real private Node distribution rather than Pi’s wrapper bin directory', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-runtime-probe-'));
  const oldDir = process.env.PI_CODING_AGENT_DIR,
    oldPath = process.env.PATH;
  process.env.PI_CODING_AGENT_DIR = join(root, 'native');
  process.env.PATH = '/usr/bin:/bin';
  t.after(async () => {
    if (oldDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = oldDir;
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(process.env.PI_CODING_AGENT_DIR);
  await writeFile(
    join(process.env.PI_CODING_AGENT_DIR, 'mcp.json'),
    JSON.stringify({ mcpServers: { qa: { command: 'npx', args: ['qa-never-execute'] } } }),
  );
  const bin = join(root, 'private', 'bin');
  await mkdir(bin, { recursive: true });
  await symlink(process.execPath, join(bin, 'node'));
  const service = new StudioService(join(root, 'prefs.json'), join(root, 'studio'));
  const store = await service.load();
  const resource = {
    id: 'qa',
    name: 'QA',
    kind: 'mcps',
    source: 'pi:qa',
    description: '',
    version: '',
    transport: 'stdio',
    args: '',
    credential: '',
    contents: '',
    createdAt: 0,
  };
  await store.saveSection('resources', [resource]);
  const native = new StudioResources(service, {
    script: '',
    piPath: () => join(bin, 'pi'),
    operation: async () => {
      throw Error('Readiness must not execute anything');
    },
  });
  const result = await native.onboardingProbe('qa', store.folder);
  assert.equal(result.missing, false);
});

test('Windows managed npm/npx use Node JS entry points with literal Unicode/space paths and preserved arguments', () => {
  const commands = nodeTools(node, 'win32', (path: string) => [npm, npx].includes(path));
  assert.deepEqual(commands.npm, { command: node, args: [npm] });
  for (const command of ['npx', 'npx.cmd', 'NPX.CMD']) {
    const entry = {
      name: 'selected',
      config: {
        command,
        args: ['-y', '@example/mcp@1.2.3', '--label', 'a & b'],
        cwd: 'D:\\Task folder',
      },
    };
    const result = withNodeCommand(entry, commands);
    assert.equal(result.config.command, node);
    assert.deepEqual(result.config.args, [npx, ...entry.config.args]);
    assert.equal(entry.config.command, command);
    assert.equal(result.config.cwd, entry.config.cwd);
  }
  assert.deepEqual(
    withNodeCommand({ config: { command: 'npm', args: ['exec'] } }, commands).config.args,
    [npm, 'exec'],
  );
  assert.equal(withNodeCommand({ config: { command: 'node.exe' } }, commands).config.command, node);
});

test('explicit executables, HTTP, unrelated commands and custom PATH selections are not silently replaced', () => {
  const commands = nodeTools(node, 'win32', () => false);
  for (const config of [
    { command: 'D:\\Other Node\\npx.cmd', args: ['custom'] },
    { command: 'npx', env: { Path: 'D:\\Other Node' } },
    { command: 'npm', env: { PATH: '${USER_NODE_PATH}' } },
    { command: 'npx' }, // A runtime without npm does not invent a path.
    { command: 'python' },
    { url: 'https://example.test/mcp' },
  ]) {
    const entry = { config };
    assert.equal(withNodeCommand(entry, commands), entry);
  }
});

test('existing editable helper roles get current setup rules without replacing user text or granting other agents setup authority', () => {
  const record = {
    projectId: 'pi-setup-assistant',
    projectRoot: '/tmp/helper',
    cwd: '/tmp/helper/work',
    output: '/tmp/helper/work/output',
    previousOutputs: [],
  };
  const prompt = sessionSystemPrompt({
    serviceAgent: true,
    instructions: 'USER EDITED ROLE',
    record,
  });
  assert.ok(prompt.includes('USER EDITED ROLE'));
  assert.ok(prompt.includes('call get_runtime'));
  assert.ok(prompt.includes('Ordinary npm libraries and CLI programs are not Pi plugins'));
  assert.ok(prompt.includes('Your helper output folder being empty says nothing'));
  const ordinary = sessionSystemPrompt({
    instructions: 'USER PROJECT',
    record: { ...record, projectId: 'ordinary' },
  });
  assert.ok(!ordinary.includes('Current setup-assistant installation rules'));
  assert.ok(setupTools.some((tool) => tool.name === 'get_runtime'));
});

test(
  'real Pi inspects its Node/npm and rejects an ordinary CLI as a Pi plugin with useful RU/EN diagnostics',
  { timeout: 60000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'pistudio-runtime-'));
    const oldDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = join(root, 'native');
    t.after(async () => {
      if (oldDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = oldDir;
      await changeLanguage('ru');
      await rm(root, { recursive: true, force: true });
    });
    await mkdir(process.env.PI_CODING_AGENT_DIR);
    const local = join(root, 'plain-cli');
    await mkdir(local);
    await writeFile(
      join(local, 'package.json'),
      JSON.stringify({ name: 'qa-ordinary-cli', version: '1.0.0', bin: { 'qa-cli': './cli.js' } }),
    );
    await writeFile(
      join(local, 'cli.js'),
      '#!/usr/bin/env node\nconsole.log("ordinary CLI, not Pi")',
    );
    const pi = await checkPi('');
    const script = fileURLToPath(new URL('../bundled/pi-bridge/resources.mjs', import.meta.url));
    const result = await nativeResourceOperation(pi.path, script, {
      action: 'inspect-runtime',
      cwd: root,
    });
    assert.equal(result.runtime?.platform, process.platform);
    assert.equal(
      result.runtime?.primaryCommandTool,
      process.platform === 'win32' ? 'powershell' : 'bash',
    );
    assert.equal(result.runtime?.shell?.available, true);
    assert.ok(result.runtime?.commandExamples?.npm);
    assert.match(result.runtime?.nodeVersion ?? '', /^v\d+/);
    assert.ok(result.runtime?.commands.npm.command);
    assert.match(result.runtime?.commands.npm.args[0] ?? '', /npm-cli\.js$/);
    assert.match(result.runtime?.commands.npx.args[0] ?? '', /npx-cli\.js$/);
    assert.ok(result.runtime?.bash?.available);
    const settings = npmSettings();
    assert.ok(settings.npmCommand?.[0]);
    for (const [language, expected] of [
      ['ru', /не является плагином Pi/],
      ['en', /not a Pi plugin/],
    ] as const) {
      await changeLanguage(language);
      await assert.rejects(
        nativeResourceOperation(pi.path, script, {
          action: 'install-package',
          cwd: root,
          source: local,
        }),
        expected,
      );
    }
    // No global auto-load, ordinary package registration or modification of user settings.
    await assert.rejects(readFile(join(process.env.PI_CODING_AGENT_DIR, 'settings.json')));
  },
);

test(
  'real native Pi checks an npx MCP through its own npm CLI with only an isolated local package/cache',
  { timeout: 90000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'pistudio-npx-mcp-'));
    const oldDir = process.env.PI_CODING_AGENT_DIR,
      oldCache = process.env.npm_config_cache;
    process.env.PI_CODING_AGENT_DIR = join(root, 'native');
    process.env.npm_config_cache = join(root, 'npm-cache');
    t.after(async () => {
      for (const [key, old] of [
        ['PI_CODING_AGENT_DIR', oldDir],
        ['npm_config_cache', oldCache],
      ]) {
        if (old === undefined) delete process.env[key!];
        else process.env[key!] = old;
      }
      await rm(root, { recursive: true, force: true });
    });
    await mkdir(process.env.PI_CODING_AGENT_DIR);
    const local = join(root, 'mcp package');
    await mkdir(local);
    await writeFile(
      join(local, 'package.json'),
      JSON.stringify({
        name: 'qa-runtime-mcp',
        version: '1.0.0',
        bin: { 'qa-runtime-mcp': 'server.cjs' },
      }),
    );
    await writeFile(
      join(local, 'server.cjs'),
      `#!/usr/bin/env node
const readline = require('node:readline');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const message=JSON.parse(line); if(message.id===undefined) return;
 const result=message.method==='initialize'?{protocolVersion:message.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'QA runtime MCP',version:'1'}}:message.method==='tools/list'?{tools:[{name:'read_only_probe',description:'QA',inputSchema:{type:'object',properties:{}}}]}:{};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result})+'\\n');
});`,
    );
    const pi = await checkPi('');
    const script = fileURLToPath(new URL('../bundled/pi-bridge/resources.mjs', import.meta.url));
    const runtime = await nativeResourceOperation(pi.path, script, {
      action: 'inspect-runtime',
      cwd: root,
    });
    const npm = runtime.runtime!.commands.npm;
    const packed = await promisify(execFile)(
      npm.command,
      [
        ...npm.args,
        'pack',
        local,
        '--pack-destination',
        root,
        '--ignore-scripts',
        '--offline',
        '--json',
      ],
      { env: process.env, timeout: 30000 },
    );
    const archive = join(root, JSON.parse(packed.stdout)[0].filename);
    for (const command of ['npx', 'npm']) {
      const args =
        command === 'npx'
          ? ['--offline', '--yes', '--package', archive, 'qa-runtime-mcp']
          : ['exec', '--offline', '--yes', '--package', archive, '--', 'qa-runtime-mcp'];
      const checked = await nativeResourceOperation(pi.path, script, {
        action: 'check-mcp',
        cwd: root,
        name: 'selected',
        config: { command, args },
      });
      assert.equal(checked.status, 'available', command);
      assert.equal(checked.toolCount, 1);
    }
    await assert.rejects(readFile(join(process.env.PI_CODING_AGENT_DIR, 'settings.json')));
  },
);
