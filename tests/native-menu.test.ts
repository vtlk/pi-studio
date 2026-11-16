import { changeLanguage } from '../src/shared/i18n/index.ts';
await changeLanguage('en');
import test from 'node:test';
import assert from 'node:assert/strict';
import type { MenuItemConstructorOptions } from 'electron';
import { menuTemplate } from '../src/main/menu/menuTemplate.ts';

function flatten(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((item) => [
    item,
    ...(Array.isArray(item.submenu) ? flatten(item.submenu) : []),
  ]);
}
for (const platform of ['darwin', 'win32'] as const) {
  test(`${platform} release menu offers exactly one manual check and preserves native editing/window/quit roles`, () => {
    let checks = 0;
    const template = menuTemplate(platform, {
      checkUpdates: () => checks++,
      about: () => {},
      help: () => {},
    });
    const all = flatten(template);
    const matches = all.filter((item) => item.id === 'check-updates');
    assert.equal(matches.length, 1);
    const parent = template.find(
      (item) => Array.isArray(item.submenu) && item.submenu.includes(matches[0]),
    );
    assert.equal(parent?.label, platform === 'darwin' ? 'Pi Studio' : 'Help');
    (matches[0].click as () => void)();
    assert.equal(checks, 1);
    for (const role of [
      'cut',
      'copy',
      'paste',
      'undo',
      'redo',
      'selectAll',
      'close',
      'quit',
      'minimize',
      'togglefullscreen',
    ])
      assert.ok(
        all.some((item) => item.role === role),
        role,
      );
    assert.equal(
      all.some((item) => ['reload', 'forceReload', 'toggleDevTools'].includes(String(item.role))),
      false,
    );
    assert.equal(
      all.some((item) => /Electron|Library|Библиотека/.test(item.label ?? '')),
      false,
    );
    assert.equal(all.filter((item) => item.role === 'quit').length, 1);
  });
}
test('development debugging commands are explicit and never enter the release template', () => {
  const actions = { checkUpdates: () => {}, about: () => {}, help: () => {} };
  const dev = flatten(menuTemplate('darwin', actions, true));
  assert.equal(
    dev.some((item) => item.role === 'toggleDevTools'),
    true,
  );
  assert.equal(
    flatten(menuTemplate('darwin', actions)).some((item) => item.role === 'toggleDevTools'),
    false,
  );
});
