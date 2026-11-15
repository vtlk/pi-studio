import { isDeepStrictEqual } from 'node:util';
import type { TerminalIdentity } from '../../../shared/runtime.ts';
import { join } from 'node:path';
import { parse, type ParseError } from 'jsonc-parser';
import { atomicJson, isMissing, readText, safePath } from '../../storage/files.ts';

export const studioTerminalProfile = '{c933e1ec-8539-47f2-baf7-d984ea553a48}';
const fragmentPath = 'Microsoft/Windows Terminal/Fragments/PiStudio/profiles.json';
const profile = {
  guid: studioTerminalProfile,
  name: 'Pi Studio',
  commandline: 'powershell.exe',
  hidden: true,
  closeOnExit: 'graceful',
};
function localData(root = process.env.LOCALAPPDATA) {
  if (!root) throw new Error('Папка LocalAppData недоступна для профиля Windows Terminal.');
  return root;
}
export async function ensureWindowsProfile(root = localData()) {
  const path = await safePath(root, fragmentPath, true);
  try {
    const current = JSON.parse(await readText(path, 65536));
    if (!isDeepStrictEqual(current, { profiles: [profile] }))
      throw new Error(
        'Профиль Pi Studio в Windows Terminal изменён. Он не перезаписывался; проверьте его настройки.',
      );
  } catch (error) {
    if (!isMissing(error)) throw error;
    await atomicJson(path, { profiles: [profile] });
  }
  return studioTerminalProfile;
}
export function checkWindowsProfileSettings(text: string) {
  const errors: ParseError[] = [];
  const value = parse(text.replace(/^\uFEFF/, ''), errors, { allowTrailingComma: true });
  if (errors.length || !value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Не удалось прочитать настройки Windows Terminal.');
  if (value.disabledProfileSources?.includes('PiStudio'))
    throw new Error('Профиль Pi Studio отключён в Windows Terminal.');
  const profiles = Array.isArray(value.profiles) ? value.profiles : (value.profiles?.list ?? []);
  if (!Array.isArray(profiles)) throw new Error('Не удалось определить профили Windows Terminal.');
  const settings = [
    value.profiles?.defaults,
    ...profiles.filter(
      (item: { guid?: string }) => item?.guid?.toLowerCase() === studioTerminalProfile,
    ),
  ];
  for (const setting of settings)
    if (
      setting &&
      Object.hasOwn(setting, 'closeOnExit') &&
      !['graceful', 'automatic', 'always', true].includes(setting.closeOnExit)
    )
      throw new Error(
        'Windows Terminal настроен оставлять вкладку Pi открытой. Настройки пользователя не изменялись; автоматическая цепочка приостановлена.',
      );
}
/** App-owned fragment only; never rewrite the user's settings.json or other profiles. */
export async function verifyWindowsProfile(root = localData()) {
  const fragment = JSON.parse(await readText(await safePath(root, fragmentPath), 65536));
  if (!isDeepStrictEqual(fragment, { profiles: [profile] }))
    throw new Error('Профиль Pi Studio изменён; автоматическое закрытие отменено.');
  const candidates = [
    'Microsoft/Windows Terminal/settings.json',
    'Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json',
    'Packages/Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe/LocalState/settings.json',
  ];
  for (const path of candidates) {
    try {
      checkWindowsProfileSettings(await readText(await safePath(root, path), 2 * 1024 * 1024));
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  return join(root, fragmentPath);
}

export function validStudioTerminalIdentity(value: unknown): value is TerminalIdentity {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<TerminalIdentity>;
  const guid = (text: unknown) =>
    typeof text === 'string' &&
    /^(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|\{[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\})$/i.test(
      text,
    );
  return (
    item.kind === 'windows-terminal' &&
    guid(item.sessionId) &&
    guid(item.profileId) &&
    item.profileId!.replace(/[{}]/g, '').toLowerCase() === studioTerminalProfile.slice(1, -1)
  );
}
