import type { CharacterRuntime } from './characterRuntime';
import { dataCharacterRuntime } from './dataCharacterRuntime';
import { getStudioApi } from '@/shared/desktopApi';

export type CharacterLoader = (
  id: string,
  version?: number,
  revision?: string,
) => Promise<CharacterRuntime>;

/** Native previews accept only main-validated data; they never load example scripts. */
export const loadLibraryCharacter: CharacterLoader = async (id, version, revision) => {
  if (version === undefined || !revision)
    throw new Error('Для персонажа отсутствует проверенная версия библиотеки.');
  const source = await getStudioApi().readLibraryCharacter(id, version, revision);
  return dataCharacterRuntime(source, id);
};
