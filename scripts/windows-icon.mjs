import { NtExecutable, NtExecutableResource } from 'pe-library';
import { Data, Resource } from 'resedit';

/** Edit PE resources directly; no Wine, Windows helper or executable launch during a cross-build. */
export function brandWindowsExecutable(binary, ico) {
  const executable = NtExecutable.from(binary);
  const resources = NtExecutableResource.from(executable);
  const icons = Data.IconFile.from(ico).icons.map((item) => item.data);
  if (icons.length < 6) throw Error('Missing multi-resolution Pi Studio icon.');
  const groups = Resource.IconGroupEntry.fromEntries(resources.entries);
  for (const group of groups.length ? groups : [{ id: 1, lang: 1033 }])
    Resource.IconGroupEntry.replaceIconsForResource(resources.entries, group.id, group.lang, icons);
  for (const version of Resource.VersionInfo.fromEntries(resources.entries)) {
    for (const language of version.getAvailableLanguages())
      version.setStringValues(language, {
        ProductName: 'Pi Studio',
        FileDescription: 'Pi Studio',
        InternalName: 'Pi Studio',
        OriginalFilename: 'Pi Studio.exe',
      });
    version.outputToResourceEntries(resources.entries);
  }
  resources.outputResource(executable);
  const result = Buffer.from(executable.generate());
  verifyWindowsIcon(result, ico);
  return result;
}

export function verifyWindowsIcon(binary, ico) {
  const executable = NtExecutable.from(binary);
  const resources = NtExecutableResource.from(executable);
  const expected = Data.IconFile.from(ico).icons.map((item) =>
    Buffer.from(item.data.isRaw() ? item.data.bin : item.data.generate()),
  );
  const groups = Resource.IconGroupEntry.fromEntries(resources.entries);
  if (!groups.length) throw Error('Executable has no icon resource.');
  for (const group of groups) {
    const actual = group
      .getIconItemsFromEntries(resources.entries)
      .map((item) => Buffer.from(item.isRaw() ? item.bin : item.generate()));
    if (actual.length !== expected.length || actual.some((item, i) => !item.equals(expected[i])))
      throw Error('Executable still contains a different icon.');
  }
  return groups.length;
}
