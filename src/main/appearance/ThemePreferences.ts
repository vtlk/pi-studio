import { t } from '../../shared/i18n/index.ts';
import { readJson, atomicJson } from '../storage/files.ts';
import { themeChoice, type ThemeChoice, type ThemeState } from '../../shared/appearance.ts';

interface NativeThemeSource {
  themeSource: 'system' | ThemeChoice;
  readonly shouldUseDarkColors: boolean;
  on(event: 'updated', listener: () => void): unknown;
  removeListener(event: 'updated', listener: () => void): unknown;
}

/** App preference, independent of every studio/project and never exported to an agent. */
export class ThemePreferences {
  private preference: ThemeState['preference'] = 'system';
  private revision = 0;
  private choiceGeneration = 0;
  private error?: string;
  private writes: Promise<void> = Promise.resolve();
  private listeners = new Set<(state: ThemeState) => void>();
  private file: string;
  private native: NativeThemeSource;
  private persist: typeof atomicJson;
  private constructor(file: string, native: NativeThemeSource, persist = atomicJson) {
    this.file = file;
    this.native = native;
    this.persist = persist;
  }
  static async load(file: string, native: NativeThemeSource, persist = atomicJson) {
    const settings = new ThemePreferences(file, native, persist);
    try {
      const data = await readJson(file);
      if (!data || typeof data !== 'object' || !themeChoice((data as { theme?: unknown }).theme))
        throw new Error('Invalid theme preference');
      settings.preference = (data as { theme: ThemeChoice }).theme;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        settings.error = t('ThemePreferences.couldNotReadTheThemePreferenceUsing');
    }
    native.themeSource = settings.preference;
    native.on('updated', settings.updated);
    return settings;
  }
  read(): ThemeState {
    return {
      preference: this.preference,
      theme: this.native.shouldUseDarkColors ? 'dark' : 'light',
      revision: this.revision,
      ...(this.error ? { error: this.error } : {}),
    };
  }
  subscribe(listener: (state: ThemeState) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit() {
    const state = this.read();
    for (const listener of this.listeners) listener(state);
  }
  private updated = () => {
    // Native events carry no old palette: always read the current effective override.
    this.revision++;
    this.emit();
  };
  async set(value: unknown): Promise<ThemeState> {
    if (!themeChoice(value)) throw new Error(t('ThemePreferences.chooseALightOrDarkTheme'));
    this.preference = value;
    this.error = undefined;
    this.native.themeSource = value;
    const requested = ++this.choiceGeneration;
    this.revision++;
    this.emit();
    const write = this.writes.then(() => this.persist(this.file, { theme: value }));
    this.writes = write.catch(() => {});
    try {
      await write;
    } catch {
      // A later explicit choice owns the visible error, even if an older write fails late.
      if (this.choiceGeneration === requested)
        this.error = t('Theme.themePreferenceNotSavedThePreviousSetting');
    }
    this.revision++;
    this.emit();
    return this.read();
  }
  async close() {
    await this.writes;
    this.native.removeListener('updated', this.updated);
    this.listeners.clear();
  }
}
