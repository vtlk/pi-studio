import { mkdir, realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type {
  StorageSection,
  StudioBootstrap,
  StudioSections,
  ProjectCommand,
} from '../../shared/storage.ts';
import { atomicJson, isMissing, readJson, safePath } from './files.ts';
import { parseSection, parseStudio } from './validation.ts';
import { ProjectStore } from './ProjectStore.ts';
import { installStandards } from './standards.ts';
import { libraryStandards } from '../../shared/libraryStandards.ts';
import { join } from 'node:path';

export class StudioStore {
  private sections: StudioSections = {};
  readonly projects: ProjectStore;
  private warnings: string[] = [];
  readonly folder: string;
  private constructor(folder: string) {
    this.folder = folder;
    this.projects = new ProjectStore(folder);
  }
  static async open(folder: string, bundled?: string) {
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
    if (bundled) {
      await installStandards(store.folder, bundled);
      const resources = Array.isArray(store.sections.resources) ? store.sections.resources : [];
      const installed = Object.entries(libraryStandards).map(([skill, metadata]) => ({
        ...metadata,
        kind: 'skills',
        source: join(store.folder, '.pistudio/packages/pi-studio-library/skills', skill),
        version: '0.1.0',
        transport: '',
        args: '',
        credential: '',
        contents: '',
        createdAt: 0,
      }));
      const ids = new Set(installed.map((item) => item.id));
      const external = resources.filter(
        (item) =>
          !(
            item &&
            typeof item === 'object' &&
            'id' in item &&
            ids.has(item.id as (typeof installed)[number]['id'])
          ),
      );
      const next = [...external, ...installed];
      if (JSON.stringify(resources) !== JSON.stringify(next))
        await store.saveSection('resources', next);
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
  private readonly bundled?: string;
  constructor(preferencesFile: string, defaultFolder: string, bundled?: string) {
    this.preferencesFile = preferencesFile;
    this.defaultFolder = defaultFolder;
    this.bundled = bundled;
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
    const next = await StudioStore.open(folder, this.bundled);
    await atomicJson(this.preferencesFile, { folder: next.folder });
    this.current = next;
    return this.current;
  }
  async open(folder: string) {
    const next = await StudioStore.open(folder, this.bundled);
    await atomicJson(this.preferencesFile, { folder: next.folder });
    this.current = next;
    return next.bootstrap();
  }
}
