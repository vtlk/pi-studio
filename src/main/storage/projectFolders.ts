import { t } from '../../shared/i18n/index.ts';
import { lstat } from 'node:fs/promises';
import { safePath, isMissing } from './files.ts';

export async function availableProjectDirectory(root: string, name: string) {
  const path = await safePath(root, `projects/${name}`, true);
  try {
    await lstat(path);
  } catch (error) {
    if (isMissing(error)) return path;
    throw error;
  }
  throw new Error(t('error.projectFolders.aFolderWithThisName'));
}
