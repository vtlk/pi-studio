import { constants } from 'node:fs';
import { open, rename, mkdir, realpath, lstat, rm } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function atomicJson(file: string, value: unknown) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(content) > 16 * 1024 * 1024)
    throw new Error('Настройки слишком большие (максимум 16 МБ).');
  await atomicText(file, content);
}
export async function atomicText(file: string, value: string) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(value);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Bound read-only work: cloud placeholders or disconnected volumes must not lock the IPC queue. */
export function withReadDeadline<T>(action: () => Promise<T>, milliseconds = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            'Чтение папки или файла не завершилось за 10 секунд. Проверьте доступность диска или выберите другую папку студии.',
          ),
        ),
      milliseconds,
    );
    action().then(resolve, reject);
  }).finally(() => clearTimeout(timer));
}
export function readJson(file: string): Promise<unknown> {
  return withReadDeadline(async () => {
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 16 * 1024 * 1024)
        throw new Error('Некорректный размер файла настроек.');
      return JSON.parse(await handle.readFile('utf8'));
    } finally {
      await handle.close();
    }
  });
}

export function isMissing(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
export function isWithin(root: string, candidate: string) {
  const path = relative(root, candidate);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}
/** Check every component: project outputs never follow symlinks, even inside the studio. */
export async function safePath(root: string, path: string, allowMissing = false) {
  if (
    typeof path !== 'string' ||
    !path ||
    isAbsolute(path) ||
    path.includes('\0') ||
    path.includes('\\')
  )
    throw new Error('Недопустимый относительный путь.');
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..'))
    throw new Error('Недопустимый относительный путь.');
  let current = await realpath(root);
  for (const part of parts) {
    current = resolve(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error('Символические ссылки не поддерживаются.');
    } catch (error) {
      if (!(allowMissing && isMissing(error))) throw error;
    }
  }
  return current;
}
export function folderLabel(value: unknown) {
  if (typeof value !== 'string') throw new Error('Введите название проекта.');
  const name = value.trim().normalize('NFC');
  if (
    !name ||
    name.length > 100 ||
    /^[.]/.test(name) ||
    /[/\\:]/.test(name) ||
    [...name].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    throw new Error('Название: 1–100 символов, без слешей, двоеточий и точки в начале.');
  return name;
}
export function readText(file: string, limit = 2 * 1024 * 1024) {
  return withReadDeadline(async () => {
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > limit)
        throw new Error('Файл слишком большой для текстового просмотра (максимум 2 МБ).');
      const bytes = await handle.readFile();
      if (bytes.includes(0)) throw new Error('Бинарный файл: текстовый просмотр недоступен.');
      return bytes.toString('utf8');
    } finally {
      await handle.close();
    }
  });
}
