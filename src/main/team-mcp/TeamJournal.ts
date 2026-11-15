import { createHash } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import { atomicJson, isMissing, readJson, safePath } from '../storage/files.ts';
import type { TeamMessage } from './types.ts';

export const messageHash = (text: string) => createHash('sha256').update(text).digest('hex');
export function messageId(projectId: string, senderId: string, requestId: string) {
  return messageHash(JSON.stringify([projectId, senderId, requestId]));
}
/** One main process owns this journal. No replay on construction/restart. */
export class TeamJournal {
  private tail: Promise<unknown> = Promise.resolve();
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.tail.then(action);
    this.tail = next.catch(() => {});
    return next;
  }
  readonly root: string;
  readonly projectId: string;
  constructor(root: string, projectId: string) {
    this.root = root;
    this.projectId = projectId;
  }
  private async directory(create = false) {
    const path = await safePath(this.root, '.pistudio/team/messages', create);
    if (create) await mkdir(path, { recursive: true, mode: 0o700 });
    return path;
  }
  private async file(id: string, create = false) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Недопустимый message_id.');
    await this.directory(create);
    return safePath(this.root, `.pistudio/team/messages/${id}.json`, create);
  }
  private async load(id: string) {
    try {
      const message = (await readJson(await this.file(id))) as TeamMessage;
      if (
        message.version !== 1 ||
        message.id !== id ||
        message.projectId !== this.projectId ||
        ![
          'queued',
          'dispatching',
          'received',
          'completed',
          'failed',
          'uncertain',
          'cancelled',
        ].includes(message.state) ||
        message.id !== messageId(message.projectId, message.senderId, message.requestId) ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(message.requestId) ||
        !/^[a-f0-9]{64}$/.test(message.bodyHash) ||
        (message.state === 'queued' &&
          (typeof message.text !== 'string' ||
            !message.text.trim() ||
            message.text.length > 190000 ||
            messageHash(message.text) !== message.bodyHash)) ||
        !Array.isArray(message.lineage) ||
        typeof message.createdAt !== 'number'
      )
        throw new Error('Журнал team повреждён или принадлежит другому проекту.');
      return message;
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  get(id: string) {
    return this.serial(() => this.load(id));
  }
  list() {
    return this.serial(async () => {
      let files: string[];
      try {
        files = await readdir(await this.directory());
      } catch (error) {
        if (isMissing(error)) return [];
        throw error;
      }
      if (files.length > 10000) throw new Error('Журнал team содержит более 10000 записей.');
      const messages = [];
      for (const name of files.filter((name) => /^[a-f0-9]{64}\.json$/.test(name))) {
        // A cloned project retains provenance but never inherits runnable delivery jobs.
        const raw = (await readJson(await this.file(name.slice(0, -5)))) as TeamMessage;
        if (raw.projectId !== this.projectId) continue;
        const message = await this.load(raw.id);
        if (message) messages.push(message);
      }
      return messages.sort(
        (a, b) =>
          (a.queueOrder ?? a.createdAt) - (b.queueOrder ?? b.createdAt) || a.id.localeCompare(b.id),
      );
    });
  }
  accept(message: TeamMessage) {
    return this.serial(async () => {
      const existing = await this.load(message.id);
      if (existing) {
        if (
          existing.bodyHash !== message.bodyHash ||
          existing.recipientId !== message.recipientId ||
          existing.senderId !== message.senderId ||
          existing.requestId !== message.requestId
        )
          throw new Error('Этот request_id уже использован для другого сообщения.');
        return existing;
      }
      const directory = await this.directory(true);
      const files = await readdir(directory);
      if (files.length >= 10000) throw new Error('Журнал team заполнен.');
      const edges: [string, string][] = [];
      let pending = 0,
        lastOrder = 0;
      for (const name of files.filter((name) => /^[a-f0-9]{64}\.json$/.test(name))) {
        const raw = (await readJson(await this.file(name.slice(0, -5)))) as TeamMessage;
        if (raw.projectId !== this.projectId) continue;
        lastOrder = Math.max(lastOrder, raw.queueOrder ?? raw.createdAt);
        const other = await this.load(name.slice(0, -5));
        if (other && ['queued', 'dispatching', 'received', 'uncertain'].includes(other.state)) {
          pending++;
          edges.push([other.senderId, other.recipientId]);
        }
      }
      if (pending >= 100) throw new Error('В проекте уже 100 незавершённых поручений team.');
      const reachable = new Set([message.recipientId]);
      for (let changed = true; changed;) {
        changed = false;
        for (const [from, to] of edges)
          if (reachable.has(from) && !reachable.has(to)) {
            reachable.add(to);
            changed = true;
          }
      }
      if (reachable.has(message.senderId)) throw new Error('Поручение создаст цикл ожидания team.');
      const ordered = { ...message, queueOrder: lastOrder + 1 };
      await atomicJson(await this.file(message.id, true), ordered);
      return ordered;
    });
  }
  update(id: string, action: (message: TeamMessage) => TeamMessage) {
    return this.serial(async () => {
      const previous = await this.load(id);
      if (!previous) throw new Error('Сообщение отсутствует.');
      const next = { ...action(previous), updatedAt: Date.now() };
      if (next.state !== 'queued') delete next.text;
      await atomicJson(await this.file(id), next);
      return next;
    });
  }
}
