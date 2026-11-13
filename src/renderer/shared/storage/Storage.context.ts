import { createContext } from 'react';
import type { StorageSection, StudioBootstrap } from '../../../shared/storage';

export interface StorageValue {
  bootstrap: StudioBootstrap | null;
  isDesktop: boolean;
  saving: boolean;
  error: string;
  chooseStudio: () => Promise<void>;
  openStudio: (folder: string) => Promise<void>;
  save: (section: StorageSection, value: unknown, base: unknown) => void;
  retry: () => void;
  saveNow: () => Promise<boolean>;
  isPending: (section: StorageSection) => boolean;
}
export const StorageContext = createContext<StorageValue | null>(null);
