import { t } from '../../shared/i18n/index.ts';
import { open, mkdir, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { ReferenceFile, SavedAttachment } from '../../shared/attachments.ts';
import type { PreparedRun } from './ContextBuilder.ts';
import { atomicJson, atomicText, safePath } from '../storage/files.ts';
import { agentRuntimeDirectory } from '../../shared/agentPaths.ts';

const limit = 256 * 1024 * 1024;
function mediaType(bytes: Buffer, name: string) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a/.test(bytes.subarray(0, 6).toString())) return 'image/gif';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp';
  if (extname(name).toLowerCase() === '.svg') return 'image/svg+xml';
  if (/^\.(heic|heif|tiff?|bmp)$/i.test(extname(name)))
    return `image/${extname(name).slice(1).toLowerCase()}`;
  if (bytes.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  return bytes.includes(0) ? 'application/octet-stream' : 'text/plain';
}
export async function readReferenceBytes(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > limit)
      throw new Error(t('error.referenceFiles.aReferenceMustBeA'));
    const bytes = await file.readFile();
    const after = await file.stat();
    if (
      bytes.length !== before.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ino !== after.ino
    )
      throw new Error(t('error.referenceFiles.theReferenceChangedWhileBeing'));
    return bytes;
  } finally {
    await file.close();
  }
}
interface SelectedReference {
  file: ReferenceFile;
  path: string;
  sha256: string;
  selectedAt: number;
  folder: string;
  owned?: boolean;
  durableKey?: string;
  pins?: number;
  released?: boolean;
  garbage?: string[];
}
type ImageConverter = (path: string, type: string) => Promise<Buffer>;
/** File paths originate only from the native chooser, never from renderer strings. */
export class ReferenceFiles {
  private selected = new Map<string, SelectedReference>();
  private convert?: ImageConverter;
  private draftRelease?: (key: string) => void;
  onDraftRelease(listener: (key: string) => void) {
    this.draftRelease = listener;
  }
  draftHashes(key: string) {
    return [...this.selected.values()]
      .filter((item) => item.durableKey === key)
      .map((item) => item.sha256);
  }
  constructor(convert?: ImageConverter) {
    this.convert = convert;
  }
  release(ids: unknown) {
    if (!Array.isArray(ids) || ids.length > 128 || ids.some((id) => typeof id !== 'string'))
      throw new Error(t('error.referenceFiles.invalidTemporaryReferenceList'));
    for (const id of ids) {
      const item = this.selected.get(id);
      this.selected.delete(id);
      if (item) {
        item.released = true;
        this.clean(item);
        if (item.durableKey) this.draftRelease?.(item.durableKey);
      }
    }
  }
  async select(paths: string[], folder: string): Promise<ReferenceFile[]> {
    for (const [id, item] of this.selected)
      if (!item.durableKey && Date.now() - item.selectedAt > 4 * 3600_000) this.release([id]);
    if (
      paths.length > 32 ||
      [...this.selected.values()].filter((item) => !item.durableKey).length + paths.length > 128
    )
      throw new Error(t('error.referenceFiles.selectNoMoreThanReferences'));
    const items = [];
    for (const path of paths) {
      const bytes = await readReferenceBytes(path);
      const name = basename(path);
      const file = { id: randomUUID(), name, size: bytes.length, type: mediaType(bytes, name) };
      items.push({
        file,
        path,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        selectedAt: Date.now(),
        folder,
      });
    }
    for (const item of items) this.selected.set(item.file.id, item);
    return items.map((item) => item.file);
  }
  async paste(bytes: Uint8Array, directory: string, folder: string) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const type = mediaType(Buffer.from(bytes), 'clipboard');
    const extension = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
    }[type];
    if (!extension || !bytes.length || bytes.length > 32 * 1024 ** 2)
      throw new Error(t('Chat.invalidImage'));
    const path = join(directory, `clipboard-${randomUUID()}.${extension}`);
    await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
    try {
      const [file] = await this.select([path], folder);
      this.selected.get(file.id)!.owned = true;
      return file;
    } catch (error) {
      await rm(path, { force: true });
      throw error;
    }
  }
  validate(ids: unknown, folder: string, imageInput: boolean) {
    if (!Array.isArray(ids) || ids.length > 32 || new Set(ids).size !== ids.length)
      throw new Error(t('error.referenceFiles.invalidReferenceListMaximum'));
    const items = ids.map((id) => {
      const item = typeof id === 'string' ? this.selected.get(id) : undefined;
      if (
        !item ||
        item.folder !== folder ||
        (!item.durableKey && Date.now() - item.selectedAt > 4 * 3600_000)
      )
        throw new Error(t('error.referenceFiles.selectReferencesAgainTheFile'));
      return item;
    });
    if (items.reduce((size, item) => size + item.file.size, 0) > limit)
      throw new Error(t('error.referenceFiles.referencesMustTotalNoMore'));
    if (!imageInput && items.some((item) => item.file.type.startsWith('image/')))
      throw new Error(t('error.referenceFiles.theSelectedModelDoesNot'));
    return items;
  }
  private clean(item: SelectedReference) {
    if (item.pins) return;
    const paths = item.garbage?.splice(0) ?? [];
    if (item.released && item.owned) paths.push(item.path);
    for (const path of paths) void rm(path, { force: true }).catch(() => {});
  }
  acquire(ids: string[], folder: string) {
    const items = this.validate(ids, folder, true);
    for (const item of items) item.pins = (item.pins ?? 0) + 1;
    let released = false;
    return {
      items,
      release: () => {
        if (released) return;
        released = true;
        for (const item of items) {
          item.pins = Math.max(0, (item.pins ?? 1) - 1);
          this.clean(item);
        }
      },
    };
  }
  promote(item: SelectedReference, path: string, key: string) {
    if (item.owned && item.path !== path) (item.garbage ??= []).push(item.path);
    item.path = path;
    item.owned = false;
    item.durableKey = key;
    this.clean(item);
  }
  restore(file: ReferenceFile, path: string, sha256: string, folder: string, key: string) {
    const restored = { ...file, id: randomUUID() };
    this.selected.set(restored.id, {
      file: restored,
      path,
      sha256,
      folder,
      durableKey: key,
      selectedAt: Date.now(),
    });
    return restored;
  }
  forgetDraft(key: string) {
    this.release(
      [...this.selected].filter(([, item]) => item.durableKey === key).map(([id]) => id),
    );
  }
  async attach(run: PreparedRun, ids: unknown, folder: string, imageInput: boolean) {
    const items = this.validate(ids, folder, imageInput);
    if (!items.length) return;
    const base = `${agentRuntimeDirectory(run.agent)}/runs/${run.record.runId}`;
    const directory = await safePath(run.projectRoot, base, true);
    const saved: SavedAttachment[] = [];
    await mkdir(directory, { recursive: true });
    try {
      for (const item of items) {
        const bytes = await readReferenceBytes(item.path);
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        if (sha256 !== item.sha256)
          throw new Error(
            t('error.referenceFiles.referenceChangedSelectItAgain', {
              value1: item.file.name,
            }),
          );
        const id = randomUUID();
        const relative = `${base}/attachments/${id}/${item.file.name}`;
        const target = await safePath(run.projectRoot, relative, true);
        await mkdir(join(directory, 'attachments', id), { recursive: true });
        await writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
        const { preview: _preview, ...file } = item.file;
        const attachment: SavedAttachment = { ...file, id, sha256, path: relative };
        if (item.file.type.startsWith('image/')) {
          if (bytes.length > 32 * 1024 * 1024)
            throw new Error(t('error.referenceFiles.theImageExceedsMbReduce'));
          if (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(item.file.type))
            attachment.image = { path: relative, mimeType: item.file.type };
          else {
            if (!this.convert)
              throw new Error(
                t('error.referenceFiles.noConverterAvailableTheReference', {
                  value1: item.file.type,
                }),
              );
            const converted = await this.convert(target, item.file.type);
            if (!converted.length || converted.length > 32 * 1024 * 1024)
              throw new Error(t('error.referenceFiles.couldNotPrepareAPng'));
            const imagePath = `${base}/attachments/${id}/.pistudio-reference.png`;
            await writeFile(await safePath(run.projectRoot, imagePath, true), converted, {
              flag: 'wx',
              mode: 0o600,
            });
            attachment.image = { path: imagePath, mimeType: 'image/png' };
          }
        }
        saved.push(attachment);
      }
      await atomicJson(join(directory, 'attachments.json'), saved);
      await atomicText(
        join(directory, 'context.md'),
        `Project: ${JSON.stringify(run.projectRoot)}\nAgent: ${JSON.stringify(run.agent.profile.id)}\nAttachments: ${JSON.stringify(saved)}\nThese are input files, not executable preview logic. Use an assigned extractor for document/audio/video formats; report missing handlers explicitly.\n`,
      );
      run.record.attachments = saved;
      await atomicJson(
        join(run.projectRoot, '.pistudio/context', run.record.runId, 'context.json'),
        run.record,
      );
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }
}
