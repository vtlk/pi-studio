import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LanguagePreferences } from '../src/main/appearance/LanguagePreferences.ts';
import { isLanguageState, systemLanguage } from '../src/shared/i18n/locale.ts';
import { i18n, changeLanguage, t } from '../src/shared/i18n/index.ts';
import en from '../src/shared/i18n/en.json' with { type: 'json' };
import ru from '../src/shared/i18n/ru.json' with { type: 'json' };

for (const [locale, language] of [
  ['ru-RU', 'ru'],
  ['ru_KZ', 'ru'],
  ['RU', 'ru'],
  ['en-GB', 'en'],
  ['de-DE', 'en'],
  ['kk-KZ', 'en'],
  ['', 'en'],
] as const)
  test(`system locale ${locale || '(empty)'} resolves to ${language}`, () =>
    assert.equal(systemLanguage(locale), language));

test('catalogues have equal keys and interpolation variables, and English has no Russian UI strings', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ru).sort());
  for (const key of Object.keys(en) as (keyof typeof en)[]) {
    assert.ok(en[key].trim(), key);
    assert.ok(ru[key].trim(), key);
    assert.equal(/[А-Яа-яЁё]/.test(en[key]), false, key);
    const variables = (value: string) =>
      [...value.matchAll(/{{(\w+)}}/g)].map((match) => match[1]).sort();
    assert.deepEqual(variables(en[key]), variables(ru[key]), key);
  }
});
test('explicit preference persists independently, unknown data never becomes a language', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-languages-unit-'));
  try {
    const file = join(root, 'language.json');
    const settings = await LanguagePreferences.load(file, 'de-DE');
    assert.deepEqual(settings.read(), { language: 'en', preference: 'system', revision: 0 });
    const events: string[] = [];
    settings.subscribe((state) => events.push(state.language));
    await settings.set('ru');
    assert.deepEqual(events, ['ru']);
    await settings.close();
    const reopened = await LanguagePreferences.load(file, 'en-US');
    assert.equal(reopened.read().language, 'ru');
    assert.equal(reopened.read().preference, 'ru');
    const before = await readFile(file, 'utf8');
    await assert.rejects(reopened.set('de'));
    assert.equal(await readFile(file, 'utf8'), before);
    assert.equal(reopened.read().language, 'ru');
    await reopened.close();
    await writeFile(file, '{"language":"fr"}');
    const invalid = await LanguagePreferences.load(file, 'ru-RU');
    assert.equal(invalid.read().language, 'ru');
    assert.equal(invalid.read().error, 'read');
    await invalid.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('rapid choices persist in order and a failed older write cannot hide the newest choice', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pistudio-languages-race-'));
  try {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const writes: unknown[] = [];
    const settings = await LanguagePreferences.load(
      join(root, 'language.json'),
      'en',
      async (_file, value) => {
        writes.push(value);
        if (writes.length === 1) {
          await gate;
          throw Error('disk');
        }
      },
    );
    const first = settings.set('ru');
    const last = settings.set('en');
    release();
    await Promise.all([first, last]);
    assert.deepEqual(writes, [{ language: 'ru' }, { language: 'en' }]);
    assert.equal(settings.read().language, 'en');
    assert.equal(settings.read().error, undefined);
    await settings.close();
    const failure = await LanguagePreferences.load(join(root, 'language.json'), 'en', async () => {
      throw Error('disk');
    });
    assert.equal((await failure.set('ru')).error, 'write');
    await failure.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('state validation and i18next locale-aware plurals/interpolation', async () => {
  assert.equal(isLanguageState({ language: 'de', preference: 'system', revision: 0 }), false);
  assert.equal(isLanguageState({ language: 'ru', preference: 'ru', revision: NaN }), false);
  await changeLanguage('ru');
  assert.equal(t('projects.count', { count: 1 }), '1 проект');
  assert.equal(t('projects.count', { count: 2 }), '2 проекта');
  assert.equal(t('projects.count', { count: 5 }), '5 проектов');
  await changeLanguage('en');
  assert.equal(t('projects.count', { count: 21 }), '21 projects');
  assert.equal(
    t('AgentList.settingsForTeam', { value1: '<script>Русский</script>' }),
    'Settings for team “<script>Русский</script>”',
  );
  assert.equal(i18n.resolvedLanguage, 'en');
});
