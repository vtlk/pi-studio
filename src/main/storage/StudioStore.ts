import { mkdir, realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type {
  StorageSection,
  StudioBootstrap,
  StudioSections,
  ProjectCommand,
  SectionEdit,
  SectionSaveResult,
} from '../../shared/storage.ts';
import { atomicJson, isMissing, readJson, safePath } from './files.ts';
import { parseSection, parseStudio } from './validation.ts';
import { ProjectStore } from './ProjectStore.ts';
import { LibraryStore } from '../library/LibraryStore.ts';

export class StudioStore {
  private sections: StudioSections = {};
  readonly projects: ProjectStore;
  readonly library: LibraryStore;
  private warnings: string[] = [];
  readonly folder: string;
  private constructor(folder: string) {
    this.folder = folder;
    this.projects = new ProjectStore(folder);
    this.library = new LibraryStore(folder);
  }
  static async open(folder: string) {
    if (typeof folder !== 'string' || !isAbsolute(folder) || folder.includes('\0'))
      throw new Error('Нужен абсолютный путь к папке студии.');
    await mkdir(folder, { recursive: true });
    const store = new StudioStore(await realpath(folder));
    await mkdir(await safePath(store.folder, '.pistudio', true), { recursive: true });
    const file = await safePath(store.folder, '.pistudio/studio.json', true);
    try {
      store.sections = parseStudio(await readJson(file));
    } catch (error) {
      if (!isMissing(error))
        throw new Error(
          `Не удалось открыть studio.json: ${error instanceof Error ? error.message : 'ошибка'}`,
          { cause: error },
        );
      await atomicJson(file, { schemaVersion: 1, sections: {} });
    }
    store.warnings = await store.projects.initialize();
    for (const [key, value] of [
      ['agents', []],
      ['connections', []],
      ['resources', []],
      ['baseInstruction', ''],
    ] as const) {
      if (store.sections[key] === undefined) await store.saveSection(key, value);
    }
    return store;
  }
  bootstrap(): StudioBootstrap {
    return {
      folder: this.folder,
      sections: structuredClone(this.sections),
      projects: this.projects.list(),
      trashProjects: this.projects.trash(),
      warnings: this.warnings,
    };
  }
  async saveSection(section: StorageSection, value: unknown) {
    const validated = parseSection(section, value);
    const sections = { ...this.sections, [section]: validated };
    await atomicJson(await safePath(this.folder, '.pistudio/studio.json'), {
      schemaVersion: 1,
      sections,
    });
    this.sections = sections;
  }
  /** Called inside StudioService's mutation queue; stale renderer values cannot replace a section. */
  async editSection(
    section: StorageSection,
    value: unknown,
    edit: SectionEdit,
  ): Promise<SectionSaveResult> {
    if (!edit || edit.folder !== this.folder)
      throw new Error('Папка студии изменилась. Правки не записаны в другую студию.');
    const local = parseSection(section, value);
    const base = parseSection(section, edit.base);
    const current = this.sections[section] ?? base;
    const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    if (equal(local, current)) return { saved: true, value: structuredClone(current) };
    if (!equal(base, current)) return { saved: false, value: structuredClone(current) };
    await this.saveSection(section, local);
    return { saved: true, value: structuredClone(local) };
  }
  command(command: ProjectCommand) {
    return this.projects.command(command);
  }
}

/** One mutation queue for settings, folder changes and project operations. */
export class StudioService {
  private queue: Promise<unknown> = Promise.resolve();
  private current?: StudioStore;
  private readonly preferencesFile: string;
  private readonly defaultFolder: string;
  constructor(preferencesFile: string, defaultFolder: string) {
    this.preferencesFile = preferencesFile;
    this.defaultFolder = defaultFolder;
  }
  serialize<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action);
    this.queue = result.catch(() => {});
    return result;
  }
  async load() {
    if (this.current) return this.current;
    let folder = this.defaultFolder;
    try {
      const saved = await readJson(this.preferencesFile);
      if (
        !saved ||
        typeof saved !== 'object' ||
        !('folder' in saved) ||
        typeof saved.folder !== 'string'
      )
        throw new Error('Некорректный путь последней студии.');
      folder = saved.folder;
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    const next = await StudioStore.open(folder);
    await atomicJson(this.preferencesFile, { folder: next.folder });
    this.current = next;
    return this.current;
  }
  async open(folder: string) {
    const next = await StudioStore.open(folder);
    await atomicJson(this.preferencesFile, { folder: next.folder });
    this.current = next;
    return next.bootstrap();
  }
}
