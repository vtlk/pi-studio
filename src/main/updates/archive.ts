import { posix } from 'node:path';
import { openPromise } from 'yauzl';
import type { UpdatePlatform } from '../../shared/updates.ts';
import { maxUnpackedBytes } from './manifest.ts';

const unsafeChars = (value: string) =>
  /[\\:]/.test(value) ||
  [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);

/** Inspect before any extractor runs. Nothing is written or executed here. */
export async function inspectUpdateArchive(
  path: string,
  platform: UpdatePlatform,
  expectedUnpacked?: number,
  signal?: AbortSignal,
) {
  const root = platform === 'darwin' ? 'Pi Studio.app' : 'Pi Studio';
  const zip = await openPromise(path, {
    lazyEntries: true,
    autoClose: false,
    strictFileNames: true,
    validateEntrySizes: true,
  });
  const entries = new Map<string, { name: string; directory: boolean; link?: string }>();
  let unpackedBytes = 0;
  const key = (name: string) => name.normalize('NFC').toLowerCase();
  try {
    for await (const entry of zip.eachEntry()) {
      signal?.throwIfAborted();
      const name = entry.fileName.replace(/\/$/, '');
      if (
        entries.size >= 100_000 ||
        entry.isEncrypted() ||
        ![0, 8].includes(entry.compressionMethod) ||
        name.length > 2048 ||
        unsafeChars(name) ||
        !(name === root || name.startsWith(root + '/')) ||
        name
          .split('/')
          .some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part)) ||
        (platform === 'win32' &&
          name
            .split('/')
            .some((part) => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part)))
      )
        throw new Error('Архив обновления содержит недопустимый путь или формат.');
      const mode = entry.externalFileAttributes >>> 16;
      const kind = mode & 0o170000;
      const directory = entry.fileName.endsWith('/');
      if (
        mode & 0o6000 ||
        ![0, 0o100000, 0o040000, 0o120000].includes(kind) ||
        (kind === 0o040000 && !directory) ||
        (kind === 0o100000 && directory) ||
        (directory && entry.uncompressedSize !== 0) ||
        (kind === 0o120000 && (directory || platform !== 'darwin')) ||
        entries.has(key(name))
      )
        throw new Error('Архив содержит конфликтующие или специальные файлы.');
      const header = await zip.readLocalFileHeaderPromise(entry);
      if (
        header.fileName.toString('utf8') !== entry.fileName ||
        header.compressionMethod !== entry.compressionMethod ||
        header.generalPurposeBitFlag !== entry.generalPurposeBitFlag
      )
        throw new Error('Заголовки архива обновления не согласованы.');
      unpackedBytes += entry.uncompressedSize;
      if (
        !Number.isSafeInteger(unpackedBytes) ||
        unpackedBytes > maxUnpackedBytes ||
        (expectedUnpacked !== undefined && unpackedBytes > expectedUnpacked)
      )
        throw new Error('Распакованный пакет превышает подписанный размер.');
      let link: string | undefined;
      if (kind === 0o120000) {
        if (entry.uncompressedSize > 4096) throw new Error('Недопустимая ссылка в архиве.');
        const stream = await zip.openReadStreamPromise(entry);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        const target = Buffer.concat(chunks).toString('utf8');
        if (!target || posix.isAbsolute(target) || unsafeChars(target))
          throw new Error('Ссылка в архиве выходит за пределы программы.');
        link = posix.normalize(posix.join(posix.dirname(name), target));
        if (!link.startsWith(root + '/'))
          throw new Error('Ссылка в архиве выходит за пределы программы.');
      }
      entries.set(key(name), { name, directory, link });
    }
    for (const item of entries.values()) {
      const parts = item.name.split('/');
      for (let i = 1; i < parts.length; i++) {
        const parent = entries.get(key(parts.slice(0, i).join('/')));
        if (parent && (!parent.directory || parent.link))
          throw new Error('Файлы архива нельзя размещать внутри ссылки или другого файла.');
      }
      if (item.link) {
        let target = item.link;
        let resolved = false;
        for (let hop = 0; hop < 40; hop++) {
          const segments = target.split('/');
          const links = segments.map((_, i) =>
            entries.get(key(segments.slice(0, i + 1).join('/'))),
          );
          const index = links.findIndex((candidate) => candidate?.link);
          if (index < 0) {
            resolved =
              entries.has(key(target)) ||
              [...entries.values()].some((candidate) => candidate.name.startsWith(target + '/'));
            break;
          }
          target = posix.join(links[index]!.link!, ...segments.slice(index + 1));
        }
        if (!resolved) throw new Error('Архив содержит циклическую или отсутствующую ссылку.');
      }
    }
    const executable =
      platform === 'darwin' ? `${root}/Contents/MacOS/Pi Studio` : `${root}/Pi Studio.exe`;
    const main =
      platform === 'darwin'
        ? `${root}/Contents/Resources/app/package.json`
        : `${root}/resources/app/package.json`;
    if (
      !entries.get(key(executable)) ||
      entries.get(key(executable))!.directory ||
      entries.get(key(executable))!.link ||
      !entries.get(key(main)) ||
      entries.get(key(main))!.directory ||
      entries.get(key(main))!.link ||
      unpackedBytes < 1 ||
      (expectedUnpacked !== undefined && unpackedBytes !== expectedUnpacked)
    )
      throw new Error('Архив не содержит полную программу ожидаемого размера.');
    signal?.throwIfAborted();
    return { root, entryCount: entries.size, unpackedBytes };
  } finally {
    zip.close();
  }
}
