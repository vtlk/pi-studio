import { t } from '../../shared/i18n/index.ts';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import type { TeamPackageFile } from '../../shared/teamPackage.ts';
import { fileDigest, packageLimit } from './packageCodec.ts';

const excluded =
  /^(?:\..*|node_modules|sessions|output|runs|logs|auth\.json|credentials(?:\..*)?|mcp\.json|settings\.json|.*\.(?:pem|p12|pfx|key|jsonl))$/i;
/** Never follows links, runtime histories, environment files or sibling resource directories. */
export async function collectPackageFiles(source: string, prefix: string) {
  const root = await realpath(source),
    files: TeamPackageFile[] = [],
    requirements: string[] = [];
  if (!(await lstat(root)).isDirectory())
    throw new Error(t('error.collectPackageFiles.aResourceFolderIsRequired'));
  let size = 0;
  const walk = async (relative: string) => {
    const directory = join(root, relative);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (excluded.test(entry.name)) {
        requirements.push(
          `Не включено ${relative ? relative + '/' : ''}${entry.name}: локальные зависимости/служебные или защищённые файлы.`,
        );
        continue;
      }
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const file = join(root, name),
        before = await lstat(file);
      if (before.isSymbolicLink() || (!before.isFile() && !before.isDirectory())) {
        requirements.push(
          `Не включено ${name}: ссылка или специальный файл; восстановить зависимость отдельно.`,
        );
        continue;
      }
      if (before.isDirectory()) {
        await walk(name);
        continue;
      }
      if (before.size > packageLimit || size + before.size > packageLimit || files.length >= 10000)
        throw new Error(t('error.collectPackageFiles.resourceFilesExceedPackageLimits'));
      // Revalidate the exact path and identity after reading, rather than exporting a changed tree.
      if ((await realpath(file)) !== file)
        throw new Error(t('error.collectPackageFiles.theResourcePathChangedDuring'));
      const bytes = await readFile(file),
        after = await lstat(file);
      if (
        !after.isFile() ||
        before.ino !== after.ino ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        bytes.length !== after.size
      )
        throw new Error(t('error.collectPackageFiles.theResourceChangedDuringExport'));
      size += bytes.length;
      files.push({
        path: `${prefix}/${name}`,
        sha256: fileDigest(bytes),
        data: bytes.toString('base64'),
        executable: !!(before.mode & 0o111),
      });
    }
  };
  await walk('');
  return { files, requirements };
}
