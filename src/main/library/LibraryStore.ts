import { cp, mkdir, readdir, lstat, rename, rm, realpath } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type {
  LibraryAsset,
  LibraryKind,
  LibraryListing,
  LibraryManifest,
} from '../../shared/library.ts';
import { atomicJson, isMissing, readJson, safePath } from '../storage/files.ts';
import { record, stableId } from '../storage/validation.ts';
import { libraryKind, signature, validateLibraryDirectory } from './manifest.ts';

interface Job {
  id: string;
  kind: LibraryKind;
  version: number;
  baseVersion: number;
  createdAt: number;
  outputRoot: string;
  published?: boolean;
}
type Checked = Awaited<ReturnType<typeof validateLibraryDirectory>>;
export class LibraryStore {
  readonly root: string;
  readonly scope: string;
  private cache = new Map<string, Checked>();
  private listing?: Promise<LibraryListing>;
  constructor(root: string) {
    this.root = root;
    this.scope = createHash('sha256').update(root).digest('hex').slice(0, 24);
  }
  private relative(kind: LibraryKind, id: string, version?: number) {
    libraryKind(kind);
    stableId(id);
    return `library/${kind}/${id}/versions${version === undefined ? '' : `/${version}`}`;
  }
  private async versions(kind: LibraryKind, id: string) {
    let entries;
    try {
      entries = await readdir(await safePath(this.root, this.relative(kind, id)));
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    if (entries.length > 1000) throw new Error('У материала больше 1000 версий.');
    return entries
      .filter((name) => /^[1-9]\d*$/.test(name) && Number.isSafeInteger(Number(name)))
      .map(Number)
      .sort((a, b) => b - a);
  }
  private async checked(kind: LibraryKind, id: string, version: number) {
    if (!Number.isSafeInteger(version) || version < 1)
      throw new Error('Некорректная версия материала.');
    const relative = this.relative(kind, id, version),
      root = await safePath(this.root, relative);
    let value = this.cache.get(relative);
    if (value) {
      const current = await Promise.all(value.files.map((file) => signature(root, file.path)));
      if (current.some((item, index) => item !== value!.files[index].signature)) value = undefined;
    }
    if (!value) {
      value = await validateLibraryDirectory(root);
      if (
        value.manifest.id !== id ||
        value.manifest.kind !== kind ||
        value.manifest.version !== version
      )
        throw new Error('asset.json не соответствует папке/версии материала.');
      this.cache.set(relative, value);
    }
    return { ...value, root };
  }
  private asset(checked: Checked): LibraryAsset {
    const manifest = checked.manifest;
    const revision = createHash('sha256')
      .update(JSON.stringify(checked.files))
      .digest('hex')
      .slice(0, 20);
    const url = (file: string) =>
      `studio-media://library/${this.scope}/${manifest.kind}/${manifest.id}/${manifest.version}/${file.split('/').map(encodeURIComponent).join('/')}?revision=${revision}`;
    return {
      id: manifest.id,
      title: manifest.title,
      description: manifest.description,
      category: manifest.category,
      image: url(manifest.files.preview),
      reference: url(manifest.files.reference),
      ...(manifest.files.vector ? { vector: url(manifest.files.vector) } : {}),
      type: manifest.kind === 'characters' ? 'character' : 'location',
      createdAt: manifest.createdAt,
      library: {
        kind: manifest.kind,
        version: manifest.version,
        animated: !!checked.character,
        revision,
      },
    };
  }
  list(): Promise<LibraryListing> {
    this.listing ??= this.scan().finally(() => {
      this.listing = undefined;
    });
    return this.listing;
  }
  private async scan(): Promise<LibraryListing> {
    const assets: LibraryAsset[] = [],
      warnings: string[] = [];
    for (const kind of ['characters', 'locations'] as const) {
      let entries;
      try {
        entries = await readdir(await safePath(this.root, `library/${kind}`), {
          withFileTypes: true,
        });
      } catch (error) {
        if (isMissing(error)) continue;
        throw error;
      }
      if (entries.length > 1000) throw new Error('В разделе библиотеки больше 1000 материалов.');
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        try {
          if (!entry.isDirectory() || entry.isSymbolicLink())
            throw new Error('Ожидалась папка материала без символических ссылок.');
          stableId(entry.name);
          const versions = await this.versions(kind, entry.name);
          if (!versions.length) throw new Error('Нет опубликованной версии.');
          for (const version of versions) {
            try {
              assets.push(this.asset(await this.checked(kind, entry.name, version)));
              break;
            } catch (error) {
              warnings.push(
                `${kind}/${entry.name}/${version}: ${error instanceof Error ? error.message : 'ошибка чтения'}`,
              );
            }
          }
        } catch (error) {
          warnings.push(
            `${kind}/${entry.name}: ${error instanceof Error ? error.message : 'ошибка чтения'}`,
          );
        }
      }
    }
    return {
      folder: this.root,
      assets: assets.sort(
        (a, b) =>
          b.createdAt - a.createdAt ||
          b.library.version - a.library.version ||
          a.id.localeCompare(b.id),
      ),
      warnings,
    };
  }
  async get(kind: LibraryKind, id: string, version?: number) {
    const selected = version ?? (await this.versions(kind, id))[0];
    if (!selected) throw new Error('Материал библиотеки не найден.');
    const checked = await this.checked(kind, id, selected);
    return {
      manifest: checked.manifest,
      directory: checked.root,
      asset: this.asset(checked),
    };
  }
  async media(scope: string, kind: LibraryKind, id: string, version: number, file: string) {
    if (scope !== this.scope) throw new Error('Папка студии изменилась.');
    const checked = await this.get(kind, id, version);
    if (
      ![
        checked.manifest.files.reference,
        checked.manifest.files.preview,
        checked.manifest.files.vector,
      ].includes(file)
    )
      throw new Error('Этот файл не является материалом предпросмотра.');
    await safePath(checked.directory, file);
    return { root: checked.directory, path: file };
  }
  async character(id: string, version: number, revision: string) {
    const checked = await this.checked('characters', stableId(id), version);
    if (!checked.character) throw new Error('У персонажа нет совместимого анимационного рига.');
    const current = this.asset(checked).library.revision;
    if (revision !== current) throw new Error('Материал изменился. Перечитайте библиотеку.');
    return { ...checked.character, revision: current };
  }
  private stage(outputRoot: string, token: string) {
    if (!/^[a-f0-9-]{36}$/.test(token)) throw new Error('Некорректный идентификатор подготовки.');
    return safePath(outputRoot, `.library-staging/${token}`, true);
  }
  private async job(outputRoot: string, token: string) {
    await this.stage(outputRoot, token);
    const data = record(
      await readJson(await safePath(this.root, `.pistudio/library-jobs/${token}.json`)),
    );
    if (data.outputRoot !== (await realpath(outputRoot)))
      throw new Error('Материал подготовлен другим агентом или проектом.');
    stableId(data.id);
    libraryKind(data.kind);
    if (
      !Number.isSafeInteger(data.version) ||
      (data.version as number) < 1 ||
      !Number.isSafeInteger(data.baseVersion)
    )
      throw new Error('Некорректная запись подготовки.');
    return data as unknown as Job;
  }
  async prepare(outputRoot: string, args: Record<string, unknown>) {
    const kind = libraryKind(args.kind);
    let previous: Awaited<ReturnType<LibraryStore['get']>> | undefined;
    if (args.existingId !== undefined) previous = await this.get(kind, stableId(args.existingId));
    const id = previous?.manifest.id ?? randomUUID(),
      versions = await this.versions(kind, id);
    const token = randomUUID(),
      version = (versions[0] ?? 0) + 1;
    const manifest: LibraryManifest = {
      schemaVersion: 1,
      id,
      kind,
      version,
      title: typeof args.title === 'string' ? args.title : (previous?.manifest.title ?? ''),
      description:
        typeof args.description === 'string'
          ? args.description
          : (previous?.manifest.description ?? ''),
      category:
        typeof args.category === 'string' ? args.category : (previous?.manifest.category ?? ''),
      createdAt: previous?.manifest.createdAt ?? Date.now(),
      files: { reference: 'reference.png', preview: 'preview.png' },
    };
    if (!manifest.title.trim() || manifest.title.length > 500)
      throw new Error('Нужно название материала до 500 символов.');
    const stage = await this.stage(outputRoot, token);
    await mkdir(stage, { recursive: true });
    await atomicJson(join(stage, 'asset.json'), manifest);
    const job: Job = {
      id,
      kind,
      version,
      baseVersion: versions[0] ?? 0,
      createdAt: manifest.createdAt,
      outputRoot: await realpath(outputRoot),
    };
    await atomicJson(await safePath(this.root, `.pistudio/library-jobs/${token}.json`, true), job);
    return {
      token,
      id,
      version,
      stagingDirectory: stage,
      manifest,
      previousDirectory: previous?.directory,
    };
  }
  private async validateJob(outputRoot: string, token: string, job: Job, root?: string) {
    const checked = await validateLibraryDirectory(root ?? (await this.stage(outputRoot, token)));
    for (const key of ['id', 'kind', 'version', 'createdAt'] as const)
      if (checked.manifest[key] !== job[key])
        throw new Error(
          'Нельзя изменять идентификатор, тип, версию или время создания подготовки.',
        );
    return checked;
  }
  async validate(outputRoot: string, token: string) {
    const job = await this.job(outputRoot, token);
    if (job.published)
      return {
        validated: true,
        published: true,
        ...(await this.get(job.kind, job.id, job.version)),
      };
    const checked = await this.validateJob(outputRoot, token, job);
    return {
      validated: true,
      id: job.id,
      version: job.version,
      animated: !!checked.character,
      files: checked.files.map((file) => file.path),
    };
  }
  async publish(outputRoot: string, token: string) {
    const job = await this.job(outputRoot, token);
    if (job.published) return this.get(job.kind, job.id, job.version);
    await this.validateJob(outputRoot, token, job);
    if (((await this.versions(job.kind, job.id))[0] ?? 0) !== job.baseVersion)
      throw new Error('Материал уже обновлён. Подготовьте новую версию по актуальным данным.');
    const stage = await this.stage(outputRoot, token),
      temporary = await safePath(this.root, `library/.publishing-${token}`, true);
    let count = 0,
      bytes = 0;
    try {
      await mkdir(await safePath(this.root, 'library', true), { recursive: true });
      await cp(stage, temporary, {
        recursive: true,
        dereference: false,
        errorOnExist: true,
        force: false,
        filter: async (source) => {
          const info = await lstat(source);
          if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()))
            throw new Error('В материале допускаются только обычные файлы и папки.');
          if (info.isFile()) {
            bytes += info.size;
            if (++count > 1000 || bytes > 256 * 1024 ** 2)
              throw new Error('Материал превышает 1000 файлов или 256 МБ.');
          }
          return true;
        },
      });
      await this.validateJob(outputRoot, token, job, temporary);
      if (((await this.versions(job.kind, job.id))[0] ?? 0) !== job.baseVersion)
        throw new Error('Версия материала изменилась во время публикации.');
      const versions = await safePath(this.root, this.relative(job.kind, job.id), true);
      await mkdir(versions, { recursive: true });
      const destination = await safePath(
        this.root,
        this.relative(job.kind, job.id, job.version),
        true,
      );
      try {
        await lstat(destination);
        throw new Error('Версия материала уже существует.');
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      await rename(temporary, destination);
      await atomicJson(await safePath(this.root, `.pistudio/library-jobs/${token}.json`), {
        ...job,
        published: true,
      });
      await rm(stage, { recursive: true, force: true });
      return this.get(job.kind, job.id, job.version);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
