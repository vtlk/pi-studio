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
    label: 'Проверить обновления…',
    click: actions.checkUpdates,
  };
  return [
    ...(mac
      ? [
          {
            role: 'appMenu',
            label: 'Pi Studio',
            submenu: [
              { label: 'О Pi Studio', click: actions.about },
              update,
              { type: 'separator' },
              { role: 'services', label: 'Службы' },
              { type: 'separator' },
              { role: 'hide', label: 'Скрыть Pi Studio' },
              { role: 'hideOthers', label: 'Скрыть остальные' },
              { role: 'unhide', label: 'Показать все' },
              { type: 'separator' },
              { role: 'quit', label: 'Завершить Pi Studio' },
            ],
          } as MenuItemConstructorOptions,
        ]
      : []),
    {
      role: 'fileMenu',
      label: 'Файл',
      submenu: [
        { role: 'close', label: 'Закрыть окно' },
        ...(!mac
          ? ([
              { type: 'separator' },
              { role: 'quit', label: 'Выход' },
            ] as MenuItemConstructorOptions[])
          : []),
      ],
    },
    {
      role: 'editMenu',
      label: 'Правка',
      submenu: [
        { role: 'undo', label: 'Отменить' },
        { role: 'redo', label: 'Повторить' },
        { type: 'separator' },
        { role: 'cut', label: 'Вырезать' },
        { role: 'copy', label: 'Скопировать' },
        { role: 'paste', label: 'Вставить' },
        { role: 'pasteAndMatchStyle', label: 'Вставить с текущим форматированием' },
        { role: 'delete', label: 'Удалить' },
        { role: 'selectAll', label: 'Выделить всё' },
        ...(mac
          ? ([
              { type: 'separator' },
              {
                label: 'Речь',
                submenu: [
                  { role: 'startSpeaking', label: 'Начать чтение' },
                  { role: 'stopSpeaking', label: 'Остановить чтение' },
                ],
              },
            ] as MenuItemConstructorOptions[])
          : []),
      ],
    },
    {
      role: 'viewMenu',
      label: 'Вид',
      submenu: [
        { role: 'resetZoom', label: 'Фактический размер' },
        { role: 'zoomIn', label: 'Увеличить' },
        { role: 'zoomOut', label: 'Уменьшить' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Полный экран' },
        ...(development
          ? ([
              { type: 'separator' },
              { role: 'reload', label: 'Перезагрузить (разработка)' },
              { role: 'toggleDevTools', label: 'Инструменты разработчика' },
            ] as MenuItemConstructorOptions[])
          : []),
      ],
    },
    {
      role: 'windowMenu',
      label: 'Окно',
      submenu: [
        { role: 'minimize', label: 'Свернуть' },
        ...(mac
          ? ([
              { role: 'zoom', label: 'Изменить размер окна' },
              { type: 'separator' },
              { role: 'front', label: 'Все окна на передний план' },
            ] as MenuItemConstructorOptions[])
          : []),
      ],
    },
    {
      role: 'help',
      label: 'Справка',
      submenu: [
        ...(!mac ? [update] : []),
        { label: 'Сообщить о проблеме…', click: actions.help },
        ...(!mac ? [{ label: 'О Pi Studio', click: actions.about }] : []),
      ],
    },
  ];
}
