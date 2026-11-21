import { t } from '../../shared/i18n/index.ts';
import type { TeamPackageFile } from '../../shared/teamPackage.ts';

export function readImportedFile(file: TeamPackageFile, args: Record<string, unknown>) {
  const offset = args.offset ?? 0;
  const limit = args.limit ?? 1024;
  const encoding = args.encoding ?? 'auto';
  const bytes = Buffer.from(file.data, 'base64');
  if (
    typeof offset !== 'number' ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > bytes.length ||
    typeof limit !== 'number' ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 65536 ||
    !['auto', 'utf8', 'base64'].includes(String(encoding))
  )
    throw Error(t('error.teamImportTools.invalidPackageReadingRange'));

  const part = bytes.subarray(offset, offset + Math.min(limit, 1024));
  const metadata = (length: number) => ({
    path: file.path,
    sha256: file.sha256,
    totalBytes: bytes.length,
    offset,
    nextOffset: offset + length < bytes.length ? offset + length : null,
  });
  if (encoding !== 'base64' && !part.includes(0)) {
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    for (let trim = 0; trim <= 3 && trim <= part.length; trim++) {
      if (trim && (trim === part.length || offset + part.length === bytes.length)) break;
      const slice = part.subarray(0, part.length - trim);
      try {
        return { ...metadata(slice.length), encoding: 'utf8', utf8: decoder.decode(slice) };
      } catch {
        // A page may end halfway through a UTF-8 character.
      }
    }
  }
  if (encoding === 'utf8') throw Error(t('CatalogRead.notUtf8'));
  return { ...metadata(part.length), encoding: 'base64', base64: part.toString('base64') };
}
