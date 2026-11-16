import { t } from '../../shared/i18n/index.ts';
import type { MenuItemConstructorOptions } from 'electron';

interface Actions {
  checkUpdates(): void;
  about(): void;
  help(): void;
}

/** Explicit release menu; framework roles keep native editing/window/quit behavior. */
export function menuTemplate(
  platform: 'darwin' | 'win32',
  actions: Actions,
  development = false,
): MenuItemConstructorOptions[] {
  const mac = platform === 'darwin';
  const update: MenuItemConstructorOptions = {
    id: 'check-updates',
    label: t('menuTemplate.checkForUpdates'),
    click: actions.checkUpdates,
  };
  return [
    ...(mac
      ? [
          {
            role: 'appMenu',
            label: 'Pi Studio',
            submenu: [
              { label: t('menuTemplate.aboutPiStudio'), click: actions.about },
              update,
              { type: 'separator' },
              { role: 'services', label: t('menuTemplate.services') },
              { type: 'separator' },
              { role: 'hide', label: t('menuTemplate.hidePiStudio') },
              { role: 'hideOthers', label: t('menuTemplate.hideOthers') },
              { role: 'unhide', label: t('menuTemplate.showAll') },
              { type: 'separator' },
              { role: 'quit', label: t('menuTemplate.quitPiStudio') },
            ],
          } as MenuItemConstructorOptions,
        ]
      : []),
    {
      role: 'fileMenu',
      label: t('menuTemplate.file'),
      submenu: [
        { role: 'close', label: t('Modal.closeWindow') },
        ...(!mac
          ? ([
              { type: 'separator' },
              { role: 'quit', label: t('menuTemplate.exit') },
            ] as MenuItemConstructorOptions[])
          : []),
      ],
    },
    {
      role: 'editMenu',
      label: t('menuTemplate.edit'),
      submenu: [
        { role: 'undo', label: t('menuTemplate.undo') },
        { role: 'redo', label: t('menu.redo') },
        { type: 'separator' },
        { role: 'cut', label: t('menuTemplate.cut') },
        { role: 'copy', label: t('menuTemplate.copy') },
        { role: 'paste', label: t('menuTemplate.paste') },
        { role: 'pasteAndMatchStyle', label: t('menuTemplate.pasteAndMatchStyle') },
        { role: 'delete', label: t('McpSecretsDialog.delete') },
        { role: 'selectAll', label: t('menuTemplate.selectAll') },
        ...(mac
          ? ([
              { type: 'separator' },
              {
                label: t('Playback.speech'),
                submenu: [
                  { role: 'startSpeaking', label: t('menuTemplate.startSpeaking') },
                  { role: 'stopSpeaking', label: t('menuTemplate.stopSpeaking') },
                ],
              },
            ] as MenuItemConstructorOptions[])
          : []),
      ],
    },
    {
      role: 'viewMenu',
      label: t('menuTemplate.view'),
      submenu: [
        { role: 'resetZoom', label: t('menuTemplate.actualSize') },
        { role: 'zoomIn', label: t('menuTemplate.zoomIn') },
        { role: 'zoomOut', label: t('menuTemplate.zoomOut') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: t('menuTemplate.fullScreen') },
        ...(development
          ? ([
              { type: 'separator' },
              { role: 'reload', label: t('menuTemplate.reloadDevelopment') },
              { role: 'toggleDevTools', label: t('menuTemplate.developerTools') },
            ] as MenuItemConstructorOptions[])
          : []),
      ],
    },
    {
      role: 'windowMenu',
      label: t('menuTemplate.window'),
      submenu: [
        { role: 'minimize', label: t('menuTemplate.minimize') },
        ...(mac
          ? ([
              { role: 'zoom', label: t('menuTemplate.zoomWindow') },
              { type: 'separator' },
              { role: 'front', label: t('menuTemplate.bringAllToFront') },
            ] as MenuItemConstructorOptions[])
          : []),
      ],
    },
    {
      role: 'help',
      label: t('menuTemplate.help'),
      submenu: [
        ...(!mac ? [update] : []),
        { label: t('menuTemplate.reportAnIssue'), click: actions.help },
        ...(!mac ? [{ label: t('menuTemplate.aboutPiStudio'), click: actions.about }] : []),
      ],
    },
  ];
}
