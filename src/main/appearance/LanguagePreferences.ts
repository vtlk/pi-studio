import { readJson, atomicJson } from '../storage/files.ts';
import { isLanguage, systemLanguage, type LanguageState } from '../../shared/i18n/locale.ts';
import { changeLanguage } from '../../shared/i18n/index.ts';

/** App-wide preference stays outside studios, profiles and team exports. */
export class LanguagePreferences {
  private state: LanguageState;
  private writes: Promise<void> = Promise.resolve();
  private listeners = new Set<(state: LanguageState) => void>();
  private file: string;
  private persist: typeof atomicJson;
  private constructor(file: string, locale: string, persist = atomicJson) {
    this.file = file;
    this.persist = persist;
    this.state = { preference: 'system', language: systemLanguage(locale), revision: 0 };
  }
  static async load(file: string, locale: string, persist = atomicJson) {
    const settings = new LanguagePreferences(file, locale, persist);
    try {
      const data = (await readJson(file)) as { language?: unknown };
      if (!isLanguage(data?.language)) throw new Error('Invalid language preference');
      settings.state = { language: data.language, preference: data.language, revision: 0 };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') settings.state.error = 'read';
    }
    await changeLanguage(settings.state.language);
    return settings;
  }
  read(): LanguageState {
    return { ...this.state };
  }
  subscribe(listener: (state: LanguageState) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit() {
    for (const listener of this.listeners) listener(this.read());
  }
  async set(value: unknown): Promise<LanguageState> {
    if (!isLanguage(value)) throw new Error('Unsupported language');
    const revision = this.state.revision + 1;
    this.state = { preference: value, language: value, revision };
    await changeLanguage(value);
    this.emit();
    const write = this.writes.then(() => this.persist(this.file, { language: value }));
    this.writes = write.catch(() => {});
    try {
      await write;
    } catch {
      if (this.state.revision === revision) {
        this.state.error = 'write';
        this.emit();
      }
    }
    return this.read();
  }
  async close() {
    await this.writes;
    this.listeners.clear();
  }
}
