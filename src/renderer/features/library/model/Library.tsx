import { getStudioApi } from '@/shared/desktopApi';
import { useStorage, useStoredState } from '@/shared/storage/Storage';
import { LibraryContext } from './Library.context';
import { useContext, useEffect, useState, type ReactNode } from 'react';
import type { LibraryListing } from '../../../../shared/library';
import type { Asset } from '../../../../shared/studio';
import { loadLibraryCharacter } from '../runtime/loadLibraryCharacter';
import type { CharacterLoader } from '../runtime/loadLibraryCharacter';

function useLibraryState(
  initial: { characters: Asset[]; locations: Asset[] },
  loadCharacter: CharacterLoader,
) {
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
        const listing = await getStudioApi().listLibrary();
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
      : [...initial.characters].reverse().filter((item) => !removedIds.includes(item.id)),
    locations: isDesktop
      ? (listing?.assets ?? []).filter(
          (item) => item.library.kind === 'locations' && !removedIds.includes(item.id),
        )
      : [...initial.locations].reverse().filter((item) => !removedIds.includes(item.id)),
    loadCharacter,
    removeAsset,
    restoreAsset,
    error,
    warnings: listing?.warnings ?? [],
  };
}
export type LibraryContextValue = ReturnType<typeof useLibraryState> | null;
export function LibraryProvider({
  children,
  initial = { characters: [], locations: [] },
  loadCharacter = loadLibraryCharacter,
}: {
  children: ReactNode;
  initial?: { characters: Asset[]; locations: Asset[] };
  loadCharacter?: CharacterLoader;
}) {
  return (
    <LibraryContext.Provider value={useLibraryState(initial, loadCharacter)}>
      {children}
    </LibraryContext.Provider>
  );
}
export function useLibrary() {
  const value = useContext(LibraryContext);
  if (!value) throw new Error('LibraryProvider is missing');
  return value;
}
