import { useStorage, useStoredState } from '@/shared/storage/Storage';
import { LibraryContext } from './Library.context';
import { useContext, useEffect, useState, type ReactNode } from 'react';
import type { LibraryListing } from '../../../../shared/library';
import { characters as initialCharacters, locations as initialLocations } from '@/fixtures/studio';

function useLibraryState() {
  const { isDesktop, bootstrap } = useStorage();
  const folder = bootstrap?.folder;
  const [disk, setDisk] = useState<{ folder: string; listing: LibraryListing } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!window.studio || !folder) return;
    let disposed = false,
      busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const listing = await window.studio!.listLibrary();
        if (!disposed && listing.folder === folder) {
          setDisk({ folder, listing });
          setError('');
        }
      } catch (error) {
        if (!disposed)
          setError(error instanceof Error ? error.message : 'Не удалось прочитать библиотеку.');
      } finally {
        busy = false;
      }
    };
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 2000);
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [folder]);
  const listing = disk?.folder === folder ? disk?.listing : undefined;
  const [removedIds, setRemovedIds] = useStoredState<string[]>('hiddenLibraryIds', []);
  const removeAsset = (id: string) => setRemovedIds((previous) => [...previous, id]);
  const restoreAsset = (id: string) =>
    setRemovedIds((previous) => previous.filter((value) => value !== id));
  return {
    characters: isDesktop
      ? (listing?.assets ?? []).filter(
          (item) => item.library.kind === 'characters' && !removedIds.includes(item.id),
        )
      : [...initialCharacters].reverse().filter((item) => !removedIds.includes(item.id)),
    locations: isDesktop
      ? (listing?.assets ?? []).filter(
          (item) => item.library.kind === 'locations' && !removedIds.includes(item.id),
        )
      : [...initialLocations].reverse().filter((item) => !removedIds.includes(item.id)),
    removeAsset,
    restoreAsset,
    error,
    warnings: listing?.warnings ?? [],
  };
}
export type LibraryContextValue = ReturnType<typeof useLibraryState> | null;
export function LibraryProvider({ children }: { children: ReactNode }) {
  return <LibraryContext.Provider value={useLibraryState()}>{children}</LibraryContext.Provider>;
}
export function useLibrary() {
  const value = useContext(LibraryContext);
  if (!value) throw new Error('LibraryProvider is missing');
  return value;
}
