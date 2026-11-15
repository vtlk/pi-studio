import { piNode } from '../pi/platform.ts';
import { createHash } from 'node:crypto';
import { mkdir, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ResourceCheck } from '../../shared/resources.ts';
import { browserMcp } from '../../shared/builtinResources.ts';
import type { PreparedRun } from '../pi/ContextBuilder.ts';
import { checkPi } from '../pi/checkPi.ts';
import { atomicJson } from '../storage/files.ts';
import {
  AGENT_BROWSER_VERSION,
  CHROME_VERSION,
  browserExecutable,
  chromeExecutable,
} from './browserVersions.ts';
import { installAgentBrowser, readAgentBrowser } from './installAgentBrowser.ts';
import { installChrome, readChrome } from './installChrome.ts';

/** Component installation is explicit; connecting the MCP never opens a browser. */
export class BrowserSupport {
  private readonly root: string;
  private readonly script: string;
  private readonly controller = new AbortController();
  private installing?: Promise<typeof browserMcp>;
  constructor(root: string, script: string) {
    this.root = root;
    this.script = script;
  }
  private get backendRoot() {
    return join(this.root, `agent-browser-${AGENT_BROWSER_VERSION}`);
  }
  private get chromeRoot() {
    return join(this.root, `chrome-${CHROME_VERSION}`);
  }
  async check(): Promise<ResourceCheck> {
    return {
      status:
        (await readAgentBrowser(this.backendRoot)) && (await readChrome(this.chromeRoot))
          ? 'available'
          : 'unavailable',
      checkedAt: Date.now(),
    };
  }
  install() {
    if (!this.installing)
      this.installing = (async () => {
        await installAgentBrowser(this.backendRoot, this.controller.signal);
        await installChrome(this.chromeRoot, this.controller.signal);
        return { ...browserMcp, check: await this.check() };
      })().finally(() => {
        this.installing = undefined;
      });
    return this.installing;
  }
  private binding(run: PreparedRun) {
    return join(this.root, 'bindings', `${run.record.runId}.json`);
  }
  async bind(run: PreparedRun, studio: string, piPath: string, visual: boolean) {
    const scope = createHash('sha256')
      .update(`${await realpath(studio)}\0${run.project.id}\0${run.agent.profile.id}`)
      .digest('hex');
    const pi = await checkPi(piPath);
    const node = await piNode(pi.path);
    if (!pi.supported) throw new Error('Browser Use требует поддерживаемый Pi 1.5.2.');
    await mkdir(join(this.root, 'bindings'), { recursive: true, mode: 0o700 });
    const binding = this.binding(run);
    await atomicJson(binding, {
      scope,
      sessions: join(this.root, 'dialogues'),
      visual,
      binary: join(this.backendRoot, browserExecutable()),
      chrome: join(this.chromeRoot, chromeExecutable()),
      projectRoot: run.projectRoot,
      outputRoot: run.record.output,
    });
    run.resources.mcpServers.push({
      name: 'pi_studio_browser',
      source: 'Pi Studio system Browser Use',
      scope: 'extension',
      config: {
        command: node,
        args: [this.script, binding],
        exposure: 'direct',
        timeout: 120,
      },
    });
    run.record.resourceIds.mcps = [...new Set([...run.record.resourceIds.mcps, browserMcp.id])];
    await atomicJson(
      join(run.projectRoot, '.pistudio/context', run.record.runId, 'context.json'),
      run.record,
    );
  }
  release(run: PreparedRun) {
    void rm(this.binding(run), { force: true }).catch(() => {});
  }
  close() {
    this.controller.abort();
  }
}
