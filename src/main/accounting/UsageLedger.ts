import { atomicJson, isMissing, safePath } from '../storage/files.ts';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import type { AgentUsage, ProjectUsage } from '../../shared/projectUsage.ts';
import { parseUsageDocument, type UsageDocument as Document } from './usageDocument.ts';
import {
  agentUsage,
  applyUsageSample,
  emptyAgentLedger,
  loseUsageRun,
  parseUsageSample,
  startUsageRun,
  sumUsage,
} from './usageState.ts';

async function readDocument(path: string): Promise<Document> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 16 * 1024 ** 2) throw new Error('Invalid usage ledger file');
    const bytes = Buffer.alloc(info.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== info.size) throw new Error('Usage ledger changed while reading');
    return parseUsageDocument(JSON.parse(bytes.subarray(0, offset).toString('utf8')));
  } finally {
    await file.close();
  }
}
/** Sidecar holds totals and dedup cursors, never a copy of the transcript/instructions. */
export class UsageLedger {
  private document: Document;
  private root: string;
  private problem = false;
  private dirty = false;
  private pending: Promise<void> = Promise.resolve();
  constructor(root: string, projectId: string) {
    this.root = root;
    this.document = { schemaVersion: 1, projectId, legacy: true, agents: {} };
  }
  get directory() {
    return this.root;
  }
  get failed() {
    return this.problem;
  }
  private async path() {
    return safePath(this.root, '.pistudio/usage.json', true);
  }
  async load(agentIds: string[], fresh = false) {
    let found = true;
    try {
      const doc = await readDocument(await this.path());
      this.document = doc;
      for (const state of Object.values(doc.agents)) {
        if (state.run?.active) this.dirty = true;
        loseUsageRun(state);
      }
    } catch (error) {
      found = false;
      if (!isMissing(error)) this.problem = true;
      this.document.legacy = !fresh;
      this.dirty = true;
    }
    for (const id of agentIds) this.agent(this.document, id, !(fresh && !found));
  }
  async relocate(root: string, projectId: string) {
    await this.pending;
    this.root = root;
    if (this.document.projectId !== projectId) {
      if (!this.problem)
        await this.update((doc) => {
          doc.projectId = projectId;
          for (const state of Object.values(doc.agents)) {
            loseUsageRun(state);
            delete state.run;
          }
        });
    }
  }
  ensureAgents(ids: string[], fresh = true) {
    for (const id of ids) this.agent(this.document, id, !fresh);
  }
  private agent(doc: Document, id: string, legacy = true) {
    if (!Object.hasOwn(doc.agents, id)) {
      Object.defineProperty(doc.agents, id, {
        value: emptyAgentLedger(legacy),
        writable: true,
        enumerable: true,
        configurable: true,
      });
      if (doc === this.document) this.dirty = true;
    }
    return doc.agents[id];
  }
  async flush() {
    if (this.dirty) await this.update(() => {});
  }
  private async update(change: (doc: Document) => void) {
    const task = this.pending.then(() => this.commit(change));
    this.pending = task.catch(() => {});
    return task;
  }
  private async commit(change: (doc: Document) => void) {
    if (this.problem)
      throw new Error('Учёт расхода недоступен: проверьте .pistudio/usage.json проекта.');
    const next = structuredClone(this.document);
    change(next);
    const clean = parseUsageDocument(next);
    await atomicJson(await this.path(), clean);
    this.document = clean;
    this.dirty = false;
  }
  async begin(agentId: string, runId: string) {
    await this.update((doc) => startUsageRun(this.agent(doc, agentId), runId));
  }
  async apply(agentId: string, runId: string | undefined, raw: unknown) {
    const sample = parseUsageSample(raw);
    await this.update((doc) => applyUsageSample(this.agent(doc, agentId), runId, sample));
  }
  async lost(agentId: string, runId: string) {
    const state = this.document.agents[agentId];
    if (state?.run?.id !== runId || !state.run.active) return;
    await this.update((doc) => loseUsageRun(doc.agents[agentId], runId));
  }
  summary(): ProjectUsage {
    const agents: Record<string, AgentUsage> = Object.create(null);
    for (const [id, state] of Object.entries(this.document.agents)) {
      agents[id] = agentUsage(state);
      if (this.problem) {
        agents[id].duration = { value: null, partial: true };
        for (const value of Object.values(agents[id].tokens)) {
          value.value = null;
          value.partial = true;
        }
        agents[id].costs = [];
        agents[id].costPartial = true;
      }
    }
    return {
      projectId: this.document.projectId,
      agents,
      total:
        !Object.keys(agents).length && this.document.legacy
          ? agentUsage(emptyAgentLedger(true))
          : sumUsage(Object.values(agents)),
    };
  }
}
