import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, realpath, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import {
  nativeBash,
  shellSettings,
  shellToolOptions,
  commandExamples,
  shellGuidance,
} from '../bundled/pi-bridge/shell-tools.mjs';
import { piEnvironment } from '../src/main/pi/platform.ts';
import { findWindowsBash } from '../src/main/pi/windowsBash.ts';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { resolvePiSdk } from '../src/main/pi/BrowserAuth.ts';
import { registerEndpoint } from '../bundled/pi-bridge/endpoint-runtime.mjs';

const bash = "E:\\Программы O'Brien $x\\Git\\bin\\bash.exe";

test('Windows defaults to native PowerShell and supplies only the host-verified Bash to SDK settings', () => {
  const env = piEnvironment(
    'C:\\Pi Node',
    { Path: 'C:\\Windows\\System32', pi_studio_native_bash: 'C:\\stale\\bash.exe' },
    'win32',
    ['E:\\Git\\bin'],
    bash,
  );
  assert.equal(env.PI_STUDIO_NATIVE_BASH, bash);
  assert.equal(env.pi_studio_native_bash, undefined);
  assert.equal(shellSettings('win32', env, (path: string) => path === bash).shellPath, bash);
  assert.deepEqual(shellSettings('win32', env, () => true).defaultTools, [
    'read',
    'powershell',
    'edit',
    'write',
  ]);
  assert.deepEqual(
    shellToolOptions('win32', env, () => true),
    {},
  );
  assert.deepEqual(shellSettings('darwin', env), {});
  assert.deepEqual(shellToolOptions('darwin', env), {});
  assert.deepEqual(
    shellToolOptions('win32', piEnvironment('C:\\Pi', env, 'win32'), () => true),
    { excludeTools: ['bash'] },
  );
});

test('missing/stale/relative/WSL Bash cannot block PowerShell or activate an unrelated shell', async () => {
  for (const path of [
    undefined,
    'C:\\missing\\bash.exe',
    'relative\\bash.exe',
    'C:relative\\bash.exe',
    'C:\\Windows\\System32\\bash.exe',
    'D:\\OS\\Sysnative\\bash.exe',
    'D:\\Local\\Microsoft\\WindowsApps\\bash.exe',
  ]) {
    const env = { PI_STUDIO_NATIVE_BASH: path };
    const exists = (candidate: string) => candidate !== 'C:\\missing\\bash.exe';
    assert.equal(nativeBash('win32', env, exists), undefined);
    assert.deepEqual(shellSettings('win32', env, exists), {
      defaultTools: ['read', 'powershell', 'edit', 'write'],
    });
    assert.deepEqual(shellToolOptions('win32', env, exists), { excludeTools: ['bash'] });
  }
  await assert.rejects(
    findWindowsBash(
      { PATH: 'relative;C:relative;\\\\network\\share' },
      async () => true,
      async () => [],
    ),
  );
});

test('runtime examples preserve native Windows path/argument boundaries using PowerShell call operator and literals', () => {
  const command = "D:\\Users\\O'Brien $name\\Node folder\\node.exe";
  const cli = "D:\\Users\\O'Brien $name\\Node folder\\node_modules\\npm\\bin\\npm-cli.js";
  const examples = commandExamples(
    { npm: { command, args: [cli, 'a; & b', '`literal`'] } },
    'win32',
  );
  assert.equal(
    examples.npm,
    "& 'D:\\Users\\O''Brien $name\\Node folder\\node.exe' 'D:\\Users\\O''Brien $name\\Node folder\\node_modules\\npm\\bin\\npm-cli.js' 'a; & b' '`literal`'",
  );
  assert.match(shellGuidance('win32'), /primary command tool is native powershell/);
  assert.match(shellGuidance('win32'), /Bash is optional/);
  assert.match(shellGuidance('darwin'), /native bash/);
});

test(
  'actual Pi SDK activates PowerShell while retaining an assigned extension and file tools without Bash',
  { timeout: 30000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'pistudio-native-powershell-'));
    const old = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = join(root, 'native');
    await mkdir(process.env.PI_CODING_AGENT_DIR);
    let session: any, runtime: any;
    t.after(async () => {
      session?.dispose();
      await runtime?.settleCredentialWrites();
      if (old === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = old;
      await rm(root, { recursive: true, force: true });
    });
    const pi = await checkPi('');
    const sdk = await import(pathToFileURL(await resolvePiSdk(await realpath(pi.path))).href);
    runtime = await sdk.ModelRuntime.create({
      authPath: join(root, 'qa-auth.json'),
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    registerEndpoint(runtime, {
      provider: 'qa-native-shell',
      endpoint: {
        url: 'http://127.0.0.1:1/v1',
        config: {
          api: 'openai-completions',
          auth: 'none',
          models: [
            {
              id: 'qa-shell',
              name: 'QA shell',
              imageInput: false,
              reasoning: false,
              contextWindow: 4096,
              maxTokens: 128,
            },
          ],
        },
      },
    });
    const settings = sdk.SettingsManager.inMemory({
      ...shellSettings('win32', {}, () => false),
      packages: [],
      skills: [],
      extensions: [],
      prompts: [],
    });
    const services = await sdk.createAgentSessionServices({
      cwd: root,
      agentDir: process.env.PI_CODING_AGENT_DIR,
      modelRuntime: runtime,
      settingsManager: settings,
      resourceLoaderOptions: {
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        systemPrompt: 'QA',
        extensionFactories: [
          (pi: any) => {
            for (const name of ['qa_assigned_tool', 'mcp__qa__bash'])
              pi.registerTool({
                name,
                description: 'QA assigned resource remains available',
                parameters: { type: 'object', properties: {} },
                execute: async () => ({ content: [{ type: 'text', text: 'QA' }] }),
              });
          },
        ],
      },
    });
    const created = await sdk.createAgentSessionFromServices({
      services,
      sessionManager: sdk.SessionManager.create(root, join(root, 'sessions')),
      model: runtime.getModel('qa-native-shell', 'qa-shell'),
      thinkingLevel: 'off',
      ...shellToolOptions('win32', {}, () => false),
    });
    session = created.session;
    const active = session.getActiveToolNames();
    assert.ok(active.includes('powershell'));
    assert.ok(!active.includes('bash'));
    for (const name of ['read', 'edit', 'write', 'qa_assigned_tool', 'mcp__qa__bash'])
      assert.ok(active.includes(name), name);
    assert.ok(!session.getAllTools().some((tool: any) => tool.name === 'bash'));
    assert.equal(settings.getShellPath(), undefined);
    const messages = session.state.messages;
    assert.equal(messages.length, 0, 'Opening does not send a user message or model request');
    assert.equal(session.model.id, 'qa-shell');
    assert.equal(session.thinkingLevel, 'off');
  },
);
