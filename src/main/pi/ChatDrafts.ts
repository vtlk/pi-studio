import { mkdir, readdir, lstat, open, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { atomicJson, readJson, safePath, isMissing } from '../storage/files.ts';
import { stableId } from '../storage/validation.ts';
import { ReferenceFiles, readReferenceBytes } from './ReferenceFiles.ts';
import type { ReferenceFile } from '../../shared/attachments.ts';
import type { ChatDraft, ChatDraftSave, ChatDraftConsumed } from '../../shared/chatDrafts.ts';
import { t } from '../../shared/i18n/index.ts';

type StoredFile = ReferenceFile & { sha256: string };
interface StoredDraft {
  schema: 1;
  projectId: string;
  agentId: string;
  revision: number;
  text: string;
  attachments: StoredFile[];
}
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const key = (projectId: string, agentId: string) => hash(JSON.stringify([projectId, agentId]));
/** Private app data, outside application versions; no paths or file reads are admitted from renderer strings. */
export class ChatDrafts {
  private scopes = new Set<string>();
  private queues = new Map<string, Promise<unknown>>();
  private locations = new Map<string, string>();
  private userData: string;
  private references: ReferenceFiles;
  private notify: (change: ChatDraftConsumed) => void;
  constructor(
    userData: string,
    references: ReferenceFiles,
    notify: (change: ChatDraftConsumed) => void = () => {},
  ) {
    this.userData = userData;
    this.references = references;
    this.notify = notify;
    references.onDraftRelease((binding) => {
      void this.sweep(binding).catch(() => {});
    });
  }
  authorize(folder: string) {
    this.scopes.add(folder);
  }
  authorized(folder: string) {
    return this.scopes.has(folder);
  }
  private scope(folder: string) {
    if (!this.scopes.has(folder)) throw Error(t('ChatDrafts.scopeChanged'));
    return hash(folder);
  }
  private async paths(folder: string, projectId: string, agentId: string) {
    stableId(projectId);
    stableId(agentId);
    const scope = this.scope(folder),
      id = key(projectId, agentId);
    const directory = await safePath(this.userData, `chat-drafts/${scope}/${id}`, true);
    this.locations.set(`${scope}/${id}`, directory);
    return { directory, binding: `${scope}/${id}` };
  }
  private async serial<T>(binding: string, action: () => Promise<T>): Promise<T> {
    const pending = this.queues.get(binding) ?? Promise.resolve();
    const result = pending.catch(() => {}).then(action);
    this.queues.set(binding, result);
    try {
      return await result;
    } finally {
      if (this.queues.get(binding) === result) this.queues.delete(binding);
    }
  }
  private parse(value: unknown): StoredDraft {
    const d = value as StoredDraft;
    if (
      !d ||
      d.schema !== 1 ||
      typeof d.text !== 'string' ||
      d.text.length > 200000 ||
      !Number.isSafeInteger(d.revision) ||
      d.revision < 0 ||
      !Array.isArray(d.attachments) ||
      d.attachments.length > 32
    )
      throw Error(t('ChatDrafts.invalidData'));
    stableId(d.projectId);
    stableId(d.agentId);
    let bytes = 0;
    const ids = new Set();
    const attachments = d.attachments.map((file) => {
      if (
        !file ||
        typeof file.id !== 'string' ||
        ids.has(file.id) ||
        typeof file.name !== 'string' ||
        !file.name ||
        file.name.length > 255 ||
        /[/\\\0]/.test(file.name) ||
        typeof file.type !== 'string' ||
        file.type.length > 150 ||
        !Number.isSafeInteger(file.size) ||
        file.size < 0 ||
        typeof file.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(file.sha256)
      )
        throw Error(t('ChatDrafts.invalidData'));
      stableId(file.id);
      ids.add(file.id);
      bytes += file.size;
      return {
        id: file.id,
        name: file.name,
        size: file.size,
        type: file.type,
        sha256: file.sha256,
        ...(typeof file.preview === 'string' &&
        file.preview.length <= 128000 &&
        /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(file.preview)
          ? { preview: file.preview }
          : {}),
      };
    });
    if (bytes > 256 * 1024 ** 2) throw Error(t('ChatDrafts.invalidData'));
    return {
      schema: 1,
      projectId: d.projectId,
      agentId: d.agentId,
      revision: d.revision,
      text: d.text,
      attachments,
    };
  }
  private async read(directory: string) {
    try {
      return this.parse(await readJson(await safePath(directory, 'draft.json')));
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }
  async load(folder: string): Promise<ChatDraft[]> {
    const scope = this.scope(folder);
    await Promise.allSettled(
      [...this.queues]
        .filter(([binding]) => binding.startsWith(scope + '/'))
        .map(([, task]) => task),
    );
    const directory = await safePath(this.userData, `chat-drafts/${scope}`, true);
    let names;
    try {
      names = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    if (names.length > 2000) throw Error(t('ChatDrafts.invalidData'));
    const result: ChatDraft[] = [];
    for (const name of names) {
      if (!/^[a-f0-9]{64}$/.test(name.name)) continue;
      const target = await safePath(directory, name.name);
      if (!name.isDirectory()) throw Error(t('ChatDrafts.invalidData'));
      const binding = `${scope}/${name.name}`;
      const draft = await this.serial(binding, async () => {
        const stored = await this.read(target);
        if (!stored) return undefined;
        if (key(stored.projectId, stored.agentId) !== name.name)
          throw Error(t('ChatDrafts.invalidData'));
        this.locations.set(binding, target);
        this.references.forgetDraft(binding);
        const attachments = [];
        for (const file of stored.attachments) {
          const path = await safePath(target, `files/${file.sha256}`, true);
          const { sha256, ...display } = file;
          attachments.push(this.references.restore(display, path, sha256, folder, binding));
        }
        await this.cleanup(target, stored.attachments, binding).catch(() => {});
        return {
          projectId: stored.projectId,
          agentId: stored.agentId,
          revision: stored.revision,
          text: stored.text,
          attachments,
        };
      });
      if (draft) result.push(draft);
    }
    return result;
  }
  async save(request: ChatDraftSave) {
    if (
      !request ||
      typeof request.folder !== 'string' ||
      !Number.isSafeInteger(request.revision) ||
      request.revision < 1 ||
      typeof request.text !== 'string' ||
      request.text.length > 200000
    )
      throw Error(t('ChatDrafts.invalidData'));
    const p = await this.paths(request.folder, request.projectId, request.agentId);
    return this.serial(p.binding, async () => {
      const previous = await this.read(p.directory);
      const lease = this.references.acquire(request.attachments, request.folder);
      const created: string[] = [];
      let committed = false;
      try {
        if (previous && request.revision <= previous.revision) {
          if (
            request.revision === previous.revision &&
            request.text === previous.text &&
            JSON.stringify(request.attachments) ===
              JSON.stringify(previous.attachments.map((f) => f.id))
          )
            return { revision: previous.revision };
          return { revision: previous.revision, conflict: true };
        }
        await mkdir(p.directory, { recursive: true, mode: 0o700 });
        const attachments: StoredFile[] = [];
        for (const item of lease.items) {
          if (item.durableKey && item.durableKey !== p.binding)
            throw Error(t('ChatDrafts.scopeChanged'));
          const target = await safePath(p.directory, `files/${item.sha256}`, true);
          if (!previous?.attachments.some((file) => file.sha256 === item.sha256)) {
            const bytes = await readReferenceBytes(item.path);
            if (hash(bytes) !== item.sha256) throw Error(t('ChatDrafts.attachmentChanged'));
            await mkdir(await safePath(p.directory, 'files', true), {
              recursive: true,
              mode: 0o700,
            });
            let output;
            try {
              output = await open(target, 'wx', 0o600);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
              if (hash(await readReferenceBytes(target)) !== item.sha256)
                throw Error(t('ChatDrafts.attachmentChanged'), { cause: error });
            }
            if (output)
              try {
                created.push(target);
                await output.writeFile(bytes);
                await output.sync();
              } finally {
                await output.close();
              }
          } else {
            const info = await lstat(target);
            if (!info.isFile() || info.size !== item.file.size)
              throw Error(t('ChatDrafts.attachmentChanged'));
          }
          attachments.push({ ...item.file, sha256: item.sha256 });
        }
        const stored = this.parse({ schema: 1, ...request, attachments });
        await atomicJson(await safePath(p.directory, 'draft.json', true), stored);
        committed = true;
        for (const item of lease.items)
          this.references.promote(item, join(p.directory, 'files', item.sha256), p.binding);
        await this.cleanup(p.directory, attachments, p.binding).catch(() => {});
        return { revision: stored.revision };
      } finally {
        lease.release();
        if (!committed) for (const file of created) await rm(file, { force: true }).catch(() => {});
      }
    });
  }
  async consume(folder: string, projectId: string, agentId: string, sentRevision: number) {
    const p = await this.paths(folder, projectId, agentId);
    return this.serial(p.binding, async () => {
      const previous = await this.read(p.directory);
      if (!previous || previous.revision !== sentRevision) return { cleared: false };
      const revision = previous.revision + 1;
      await atomicJson(await safePath(p.directory, 'draft.json'), {
        ...previous,
        text: '',
        attachments: [],
        revision,
      });
      try {
        this.notify({ folder, projectId, agentId, sentRevision, revision });
      } catch {
        /* Persisted state remains authoritative if the old renderer closed. */
      }
      await this.cleanup(p.directory, [], p.binding).catch(() => {});
      return { cleared: true, revision };
    });
  }
  async close() {
    await Promise.allSettled([...this.queues.values()]);
  }
  private async sweep(binding: string) {
    const directory = this.locations.get(binding);
    if (!directory) return;
    await this.serial(binding, async () => {
      const stored = await this.read(directory);
      if (stored) await this.cleanup(directory, stored.attachments, binding);
    });
  }
  private async cleanup(directory: string, files: StoredFile[], binding: string) {
    const keep = new Set([
      ...files.map((file) => file.sha256),
      ...this.references.draftHashes(binding),
    ]);
    const root = await safePath(directory, 'files', true);
    let names;
    try {
      names = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
    for (const file of names)
      if (file.isFile() && /^[a-f0-9]{64}$/.test(file.name) && !keep.has(file.name))
        await rm(await safePath(root, file.name));
  }
}
