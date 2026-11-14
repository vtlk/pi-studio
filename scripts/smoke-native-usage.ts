import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { checkPi } from '../src/main/pi/checkPi.ts';
import { resolvePiSdk } from '../src/main/pi/BrowserAuth.ts';
import { collectUsage } from '../bundled/pi-bridge/accounting/usage.mjs';
import { UsageLedger } from '../src/main/accounting/UsageLedger.ts';
import { readNativeUsage } from '../src/main/accounting/readNativeUsage.ts';

// Public native SDK statistics/fork contract with synthetic usage entries; no model/HTTP requests.
const root = await realpath(await mkdtemp(join(tmpdir(), 'pistudio-native-usage-')));
let requests = 0; const previousFetch = global.fetch;
global.fetch = async () => { requests++; throw Error('Native usage inspection must be offline.'); };
const sessions: { dispose(): void }[] = [];
try {
  const pi = await checkPi(''), sdk = await import(pathToFileURL(await resolvePiSdk(await realpath(pi.path))).href);
  const agentDir = join(root, 'native'); await mkdir(agentDir);
  const models = await sdk.ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const model = models.getModels()[0]; assert.ok(model);
  const settings = sdk.SettingsManager.inMemory({ packages: [], extensions: [], skills: [], prompts: [] });
  const loader = new sdk.DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings, noExtensions: true, disabledBuiltinExtensions: ['mcp', 'codemode', 'tool-search'], noSkills: true, noPromptTemplates: true, noContextFiles: true, noThemes: true });
  await loader.reload();
  const manager = sdk.SessionManager.create(root, join(root, 'sessions'));
  const usage = { input: 10, output: 3, cacheRead: 7, cacheWrite: 2, totalTokens: 22, cost: { input: .1, output: .2, cacheRead: .3, cacheWrite: .4, total: 1 } };
  manager.appendMessage({ role: 'user', content: 'Synthetic usage fixture', timestamp: Date.now() });
  manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'Synthetic response' }], api: model.api, provider: model.provider, model: model.id, usage, stopReason: 'stop', timestamp: Date.now() });
  manager.appendUsage('fixture', model.provider, model.id, usage);
  manager.appendCompaction('Synthetic compaction', manager.getLeafId(), 22, undefined, false, usage);
  manager.branchWithSummary(manager.getLeafId(), 'Synthetic branch', undefined, false, usage);
  manager.appendMessage({ role: 'toolResult', toolCallId: 'synthetic', toolName: 'fixture', content: [{ type: 'text', text: 'Synthetic tool response' }], isError: false, timestamp: Date.now(), usage });
  const make = async manager => {
    const result = await sdk.createAgentSession({ cwd: root, agentDir, modelRuntime: models, model, settingsManager: settings, resourceLoader: loader, sessionManager: manager, noTools: 'all' });
    sessions.push(result.session); return result.session;
  };
  const session = await make(manager), stats = session.getSessionStats(), rows = collectUsage(manager.getEntries());
  assert.equal(rows.length, 5);
  const ledger = new UsageLedger(root, 'native-project'); await ledger.load(['agent'], true); await ledger.flush();
  await ledger.apply('agent', undefined, { records: rows });
  const total = ledger.summary().total;
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'total']) assert.equal(total.tokens[key].value, stats.tokens[key]);
  assert.equal(total.costs[0].value, stats.cost);
  const canonical = manager.getSessionFile(); assert.ok(canonical);
  const before = await readFile(canonical, 'utf8');
  const recovered = await readNativeUsage(pi.path, join(process.cwd(), 'bundled/pi-bridge/accounting/read-usage.mjs'), canonical, root, new AbortController().signal);
  assert.deepEqual(recovered, rows, 'The offline native reader recovers exactly the same numeric usage.');
  assert.equal(await readFile(canonical, 'utf8'), before, 'Offline recovery preserves canonical bytes.');
  const fork = sdk.SessionManager.forkFrom(canonical, root, join(root, 'fork'));
  assert.deepEqual(collectUsage(fork.getEntries()).map(row => row.id), rows.map(row => row.id));
  fork.appendUsage('after-fork', model.provider, model.id, usage);
  const forkSession = await make(fork), forkStats = forkSession.getSessionStats();
  await ledger.apply('agent', undefined, { records: collectUsage(fork.getEntries()) });
  assert.equal(ledger.summary().total.tokens.input.value, forkStats.tokens.input);
  assert.equal(ledger.summary().total.costs[0].value, forkStats.cost);
  assert.equal(await readFile(canonical, 'utf8'), before, 'Reading stats/forking never edits the source history.');
  assert.equal(requests, 0);
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/native-usage-api-proof.json', JSON.stringify({ checkedAt: new Date().toISOString(), pi: pi.version, scope: 'Actual native AgentSession.getSessionStats and SessionManager.forkFrom with synthetic usage entries', modelRequests: 0, networkRequests: requests, nativeTokens: stats.tokens, nativeCost: stats.cost, ledgerMatchesNativeStats: true, compactionBranchToolAuxiliaryIncluded: true, forkEntryIdentitiesPreserved: true, seededForkNotDoubleCharged: true, sourceTranscriptUnchanged: true, costUnits: 'USD, verified in pinned Pi model-schema and telemetry contract' }, null, 2) + '\n');
  console.log('Native Pi usage API passed: exact tokens/cost across all five usage sources, fork identity and no double charge; zero model/network requests.');
} finally {
  for (const session of sessions) session.dispose(); global.fetch = previousFetch;
  await rm(root, { recursive: true, force: true });
}
