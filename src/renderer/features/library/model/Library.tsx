import { LibraryContext } from './Library.context';
import { useContext, useState, type ReactNode } from 'react';
import { characters as initialCharacters, locations as initialLocations } from '@/fixtures/studio';

function useLibraryState() {
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const removeAsset = (id: string) => setRemovedIds((previous) => [...previous, id]);
  const restoreAsset = (id: string) =>
    setRemovedIds((previous) => previous.filter((value) => value !== id));
  return {
    characters: [...initialCharacters].reverse().filter((item) => !removedIds.includes(item.id)),
    locations: [...initialLocations].reverse().filter((item) => !removedIds.includes(item.id)),
    removeAsset,
    restoreAsset,
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
