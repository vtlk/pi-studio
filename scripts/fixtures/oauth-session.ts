import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, realpath, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolvePiSdk } from '../../src/main/pi/BrowserAuth.ts';
import { buildRunContext } from '../../src/main/pi/ContextBuilder.ts';
import { RunHost } from '../../src/main/pi/RunHost.ts';
import type { StudioService } from '../../src/main/storage/StudioStore.ts';
import type { McpSecrets } from '../../src/main/pi/McpSecrets.ts';
import type { Resource } from '../../src/shared/resources.ts';
import type { Agent } from '../../src/shared/studio.ts';

/** Native production bridge, real OAuth transport, seeded QA transcript; no LLM request. */
export async function verifyOAuthResume(
  service: StudioService,
  secrets: McpSecrets,
  resource: Resource,
  piPath: string,
  root: string,
  fixture: {
    state: { connected: number; listed: number; refreshed: number };
    expireAccess(): void;
    secret: string;
  },
) {
  const store = await service.load();
  const sdk = await import(pathToFileURL(await resolvePiSdk(await realpath(piPath))).href);
  const agent: Agent = {
    id: 'oauth-resume-agent',
    name: 'OAuth resume QA',
    enabled: true,
    skills: [],
    mcps: [resource.id],
    plugins: [],
    instructions: [],
    mainInstruction: 'QA idle session. Wait for the user; do not generate anything.',
    model: {
      connectionId: 'qa',
      provider: 'openai',
      id: 'gpt-4.1',
      reasoning: 'Низкий',
      temperature: '',
    },
  };
  await store.saveSection('agents', [agent]);
  const project = (
    await store.command({ kind: 'create', name: 'OAuth resume QA', agents: [agent] })
  ).projects[0];
  const directory = await store.projects.directory(project.id);
  const cwd = join(directory, dirname(project.agents[0].outputPath));
  const manager = sdk.SessionManager.create(cwd, join(cwd, 'sessions'));
  manager.appendThinkingLevelChange('off');
  manager.appendMessage({
    role: 'user',
    content: 'Seeded QA history; never send this to a model.',
    timestamp: Date.now(),
  });
  manager.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: 'Seeded QA response; awaiting input.' }],
    api: 'openai-responses',
    provider: 'openai',
    model: 'gpt-4.1',
    stopReason: 'stop',
    timestamp: Date.now(),
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  });
  const path = manager.getSessionFile();
  const transcript = await readFile(path, 'utf8');
  await store.projects.updateRuntime(project.id, agent.id, 'stopped', {
    id: manager.getSessionId(),
    path: relative(directory, path),
    title: agent.name,
    createdAt: Date.now(),
  });
  const children: Promise<number | null>[] = [];
  const host = new RunHost({
    bootstraps: join(root, 'boots'),
    bridge: resolve('bundled/pi-bridge/session.mjs'),
    headless: true,
    prepare: (request) =>
      service.serialize(async () => ({
        piPath,
        run: await buildRunContext(
          directory,
          await store.projects.read(request.projectId),
          request.agentId,
          [agent],
          store.bootstrap().sections.resources as Resource[],
          secrets.resolver(store.folder, piPath),
        ),
      })),
    update: (run, status, session) =>
      service.serialize(() =>
        store.projects.updateRuntime(run.project.id, agent.id, status, session),
      ),
    read: () => service.serialize(() => store.projects.read(project.id)),
    openTerminal: async (node, bridge, bootstrap) => {
      const child = spawn(node, [bridge, bootstrap], {
        stdio: 'ignore',
        env: { ...process.env, PI_OFFLINE: '1', PI_TELEMETRY: '0' },
      });
      children.push(
        new Promise((resolve, reject) => {
          child.once('error', reject);
          child.once('exit', resolve);
        }),
      );
    },
  });
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const before = { ...fixture.state };
      if (attempt === 1) fixture.expireAccess();
      await host.launch({ projectId: project.id, agentId: agent.id, autoContinue: false });
      assert.equal(await children[attempt], 0);
      assert.ok(
        fixture.state.connected > before.connected,
        'Bound session loads its assigned OAuth MCP',
      );
      assert.ok(fixture.state.listed > before.listed, 'Native tools are actually discovered');
      if (attempt === 1)
        assert.ok(
          fixture.state.refreshed > before.refreshed,
          'Native resume refreshes the expired access token',
        );
      assert.equal(
        await readFile(path, 'utf8'),
        transcript,
        'Idle resume sends no request and preserves exact history',
      );
      assert.equal(
        (await store.projects.read(project.id)).agents[0].session?.id,
        manager.getSessionId(),
      );
    }
    async function inspect(directory: string) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await inspect(path);
        else
          assert.equal(
            (await readFile(path, 'utf8')).includes(fixture.secret),
            false,
            'No clientSecret in project/run/history',
          );
      }
    }
    await inspect(store.folder);
    await inspect(join(root, 'boots'));
  } finally {
    host.close();
    await Promise.allSettled(children);
  }
}
