import { t } from '../../shared/i18n/index.ts';
import { piNode } from '../pi/platform.ts';
import { createHash } from 'node:crypto';
import { mkdir, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ResourceCheck } from '../../shared/resources.ts';
import type { BrowserState } from '../../shared/browser.ts';
import { browserMcp } from '../../shared/builtinResources.ts';
import { hasBuiltinMcp } from '../../shared/builtinAssignments.ts';
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
  private installingVisible?: Promise<BrowserState>;
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
  private get visibleChromeRoot() {
    return join(this.root, `chrome-visible-${CHROME_VERSION}`);
  }
  async state(): Promise<BrowserState> {
    const [backend, headless, headed] = await Promise.all([
      readAgentBrowser(this.backendRoot).catch(() => undefined),
      readChrome(this.chromeRoot).catch(() => undefined),
      process.platform === 'darwin'
        ? readChrome(this.visibleChromeRoot, true).catch(() => undefined)
        : undefined,
    ]);
    return {
      headlessInstalled: !!backend && !!headless,
      headedInstalled: !!backend && !!headed,
      headedSupported: process.platform === 'darwin',
    };
  }
  installVisible() {
    if (process.platform !== 'darwin')
      throw new Error(t('error.browserSupport.visibleBrowserUseIsCurrently'));
    this.installingVisible ??= (async () => {
      // Share backend installation with an already admitted ordinary component install.
      if (this.installing) await this.installing;
      else await installAgentBrowser(this.backendRoot, this.controller.signal);
      await installChrome(this.visibleChromeRoot, this.controller.signal, { headed: true });
      return this.state();
    })().finally(() => {
      this.installingVisible = undefined;
    });
    return this.installingVisible;
  }
  async check(): Promise<ResourceCheck> {
    const state = await this.state();
    return {
      status: state.headlessInstalled || state.headedInstalled ? 'available' : 'unavailable',
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
    if (!hasBuiltinMcp(run.agent.profile, browserMcp.id)) return;
    const scope = createHash('sha256')
      .update(`${await realpath(studio)}\0${run.project.id}\0${run.agent.profile.id}`)
      .digest('hex');
    const pi = await checkPi(piPath);
    const node = await piNode(pi.path);
    if (!pi.supported) throw new Error(t('error.browserSupport.browserUseRequiresTheSupported'));
    await mkdir(join(this.root, 'bindings'), { recursive: true, mode: 0o700 });
    const binding = this.binding(run);
    await atomicJson(binding, {
      studioFile: join(studio, '.pistudio/studio.json'),
      agentId: run.agent.profile.id,
      scope,
      sessions: join(this.root, 'dialogues'),
      visual,
      binary: join(this.backendRoot, browserExecutable()),
      chrome: join(this.chromeRoot, chromeExecutable()),
      ...(process.platform === 'darwin'
        ? { headedChrome: join(this.visibleChromeRoot, chromeExecutable(true)) }
        : {}),
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
  assertUpdateIdle() {
    if (this.installing || this.installingVisible)
      throw new Error(t('error.browserSupport.waitForBrowserComponentsTo'));
  }
}
