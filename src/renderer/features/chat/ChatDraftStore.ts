import type { DesktopApi } from '../../../shared/contracts';
import type { ChatDraft, ChatDraftConsumed, ChatSendResult } from '../../../shared/chatDrafts';
import type { ReferenceAttachment } from '@/shared/ui/ReferenceAttachments';
import { t } from '../../../shared/i18n/index.ts';

type Api = Pick<DesktopApi, 'loadChatDrafts' | 'saveChatDraft'>;
interface Entry {
  folder: string;
  projectId: string;
  agentId: string;
  revision: number;
  saved: number;
  timer?: ReturnType<typeof setTimeout>;
  flight?: Promise<void>;
  error?: 'ChatDrafts.saveFailed';
  consumed?: number;
  conflicts?: number;
}
export const chatDraftKey = (folder: string, target: { projectId: string; agentId: string }) =>
  `${folder}/${target.projectId}/${target.agentId}`;
/** One app-window store; async completions always address the original studio/project/agent. */
export class ChatDraftStore {
  readonly drafts = new Map<string, string>();
  readonly attachments = new Map<string, ReferenceAttachment[]>();
  private entries = new Map<string, Entry>();
  private loaded = new Set<string>();
  private loads = new Map<string, Promise<void>>();
  private loadErrors = new Map<string, 'ChatDrafts.restoreFailed'>();
  private listeners = new Set<() => void>();
  private version = 0;
  private api?: Api;
  constructor(api?: Api) {
    this.api = api;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.version;
  private emit() {
    this.version++;
    for (const listener of this.listeners) listener();
  }
  ready(folder: string) {
    return this.loaded.has(folder);
  }
  error() {
    const key =
      this.loadErrors.values().next().value ??
      [...this.entries.values()].find((e) => e.error)?.error;
    return key ? t(key) : undefined;
  }
  unsaved() {
    return this.loads.size > 0 || [...this.entries.values()].some((e) => e.revision > e.saved);
  }
  private entry(key: string) {
    let entry = this.entries.get(key);
    if (!entry) {
      const i = key.lastIndexOf('/'),
        j = key.lastIndexOf('/', i - 1);
      entry = {
        folder: key.slice(0, j),
        projectId: key.slice(j + 1, i),
        agentId: key.slice(i + 1),
        revision: 0,
        saved: 0,
      };
      this.entries.set(key, entry);
    }
    return entry;
  }
  async load(folder: string) {
    if (this.loaded.has(folder)) return;
    const active = this.loads.get(folder);
    if (active) return active;
    const work = Promise.resolve().then(async () => {
      try {
        if (this.api) {
          const result = await this.api.loadChatDrafts({ folder });
          if (result?.folder !== folder || !Array.isArray(result.drafts)) throw Error();
          for (const draft of result.drafts) {
            const key = chatDraftKey(folder, draft),
              entry = this.entry(key);
            if (entry.revision > entry.saved) continue;
            entry.revision = entry.saved = draft.revision;
            this.drafts.set(key, draft.text);
            this.attachments.set(key, draft.attachments);
          }
        }
        this.loaded.add(folder);
        this.loadErrors.delete(folder);
      } catch {
        this.loadErrors.set(folder, 'ChatDrafts.restoreFailed');
      } finally {
        this.loads.delete(folder);
        this.emit();
      }
    });
    this.loads.set(folder, work);
    this.emit();
    await work;
  }
  private changed(key: string) {
    const entry = this.entry(key);
    entry.revision++;
    entry.error = undefined;
    entry.conflicts = 0;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => void this.persist(key), 250);
    this.emit();
  }
  setText(key: string, text: string) {
    if ((this.drafts.get(key) ?? '') === text) return;
    this.drafts.set(key, text);
    this.changed(key);
  }
  setAttachments(key: string, files: ReferenceAttachment[]) {
    if (
      JSON.stringify((this.attachments.get(key) ?? []).map((f) => f.id)) ===
      JSON.stringify(files.map((f) => f.id))
    )
      return;
    this.attachments.set(key, files);
    this.changed(key);
  }
  current(key: string): ChatDraft {
    const entry = this.entry(key);
    return {
      projectId: entry.projectId,
      agentId: entry.agentId,
      revision: entry.revision,
      text: this.drafts.get(key) ?? '',
      attachments: this.attachments.get(key) ?? [],
    };
  }
  private async persist(key: string): Promise<void> {
    const entry = this.entry(key);
    clearTimeout(entry.timer);
    if (entry.flight) return entry.flight;
    if (entry.revision <= entry.saved || !this.api) return;
    const revision = entry.revision;
    const snapshot = {
      ...this.current(key),
      folder: entry.folder,
      attachments: (this.attachments.get(key) ?? []).map((f) => f.id),
    };
    const work = Promise.resolve().then(async () => {
      try {
        const ack = await this.api!.saveChatDraft(snapshot);
        if (ack?.conflict) {
          entry.conflicts = (entry.conflicts ?? 0) + 1;
          if (entry.conflicts > 3) throw Error();
          entry.revision = Math.max(entry.revision, ack.revision) + 1;
          entry.error = undefined;
          return;
        }
        if (ack?.revision !== revision) throw Error();
        entry.conflicts = 0;
        entry.saved = Math.max(entry.saved, revision);
        entry.error = undefined;
      } catch {
        if (entry.revision === revision) entry.error = 'ChatDrafts.saveFailed';
      } finally {
        entry.flight = undefined;
        this.emit();
        if (entry.revision > entry.saved && !entry.error)
          entry.timer = setTimeout(() => void this.persist(key), 0);
      }
    });
    entry.flight = work;
    return work;
  }
  async flush(key?: string) {
    await Promise.all([...this.loads.values()]);
    const keys = key ? [key] : [...this.entries.keys()];
    for (const id of keys) {
      const entry = this.entry(id);
      entry.error = undefined;
      entry.conflicts = 0;
      while (entry.revision > entry.saved) {
        if (!this.api) return false;
        await this.persist(id);
        if (entry.error) return false;
      }
    }
    return true;
  }
  consumed(change: ChatDraftConsumed) {
    const key = chatDraftKey(change.folder, change),
      entry = this.entries.get(key);
    if (!entry || (entry.consumed ?? 0) >= change.revision) return false;
    entry.consumed = change.revision;
    if (entry.revision !== change.sentRevision) {
      if (entry.revision > entry.saved) {
        entry.revision = Math.max(entry.revision, change.revision) + 1;
        entry.error = undefined;
        clearTimeout(entry.timer);
        entry.timer = setTimeout(() => void this.persist(key), 0);
        this.emit();
      }
      return false;
    }
    clearTimeout(entry.timer);
    this.drafts.set(key, '');
    this.attachments.set(key, []);
    entry.revision = entry.saved = change.revision;
    entry.error = undefined;
    this.emit();
    return true;
  }
  sent(key: string, sentRevision: number, result: ChatSendResult | void) {
    const entry = this.entry(key);
    if (entry.revision !== sentRevision) return false;
    if (result?.draft?.cleared && result.draft.revision !== undefined)
      return this.consumed({
        ...entry,
        folder: entry.folder,
        sentRevision,
        revision: result.draft.revision,
      });
    this.drafts.set(key, '');
    this.attachments.set(key, []);
    this.changed(key);
    return true;
  }
  async retry() {
    for (const folder of this.loadErrors.keys()) await this.load(folder);
    return this.flush();
  }
}
