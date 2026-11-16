# Ревью native-меню — MENU-01 / UPD-04

Read-only Accessibility-снимок реально установленной macOS alpha.77: `artifacts/native-menu-before-proof.json`. Приложение не активировалось, пункты не нажимались, клавиатура/Clipboard/звук не использовались. Apple menu и пользовательское содержимое Services не входят в меню, которым управляет Pi Studio; они не записаны в proof. Имена проектов/недавних документов ОС не сохранялись. Полной native Windows-съёмки сейчас нет.

У alpha.77 нет собственного шаблона Menu/Tray: используются defaults Electron. Реально найдены release-пункты Reload, Force Reload и Toggle Developer Tools, а также старый заголовок окна «видеостудия». В source alpha.78 добавлен явный `menuTemplate`; debug-роли доступны только в development. В исходниках нет собственного Tray/status-item.

## Перечень фактической Mac alpha.77 и решения

AX mask записан как исходное поле API; активность — моментальный снимок, зависит от фокуса/контекста macOS. Имена handler для обычных действий сопоставлены с native ролями Electron; действия в пользовательском процессе не вызывались. OS-generated дополнения (подстановки, Autofill, dictation/emoji, layout/Stage Manager и alternate commands) сохраняются через платформенные роли и контекст ОС, без собственных копий. Их наличие/сочетания в финальном пакете предстоит пересверить.

| Текущий путь | Доступен | Key / modifiers | Решение | Native role / handler | Причина |
|---|---|---|---|---|---|
| Pi Studio | да | — | Оставить, локализовать | OS-generated submenu/action | Раздел навигации native-меню. |
| Pi Studio / About Pi Studio | да | — | Оставить, локализовать | app.showAboutPanel | Штатная операция редактирования/окна/выхода; существующие guards остаются. |
| Pi Studio / Services | да | — | Оставить, локализовать | services | Штатная операция редактирования/окна/выхода; существующие guards остаются. |
| Pi Studio / Hide Pi Studio | да | H / AX mask 0 | Оставить, локализовать | hide | Штатная операция редактирования/окна/выхода; существующие guards остаются. |
| Pi Studio / Hide Others | да | H / AX mask 2 | Оставить, локализовать | hideOthers | Штатная операция редактирования/окна/выхода; существующие guards остаются. |
| Pi Studio / Show All | да | — | Оставить, локализовать | unhide | Штатная операция редактирования/окна/выхода; существующие guards остаются. |
| Pi Studio / Quit Pi Studio | да | Q / AX mask 0 | Оставить, локализовать | quit | Штатная операция редактирования/окна/выхода; существующие guards остаются. |
| Pi Studio / Quit and Keep Windows | да | Q / AX mask 2 | Оставить, локализовать | quit (OS alternate) | Штатная операция редактирования/окна/выхода; существующие guards остаются. |
| File | да | — | Оставить, локализовать | OS-generated submenu/action | Раздел навигации native-меню. |
| File / Close Window | да | W / AX mask 0 | Оставить, локализовать | close | Штатная операция редактирования/окна/выхода; существующие guards остаются. |
| File / Close All | да | W / AX mask 2 | Оставить, локализовать | close (OS alternate) | Штатная операция редактирования/окна/выхода; существующие guards остаются. |
| Edit | да | — | Оставить, локализовать | OS-generated submenu/action | Раздел навигации native-меню. |
| Edit / Undo | да | Z / AX mask 0 | Оставить, локализовать | undo | Штатная операция редактирования/окна/выхода; существующие guards остаются. |
| Edit / Redo | да | Z / AX mask 1 | Оставить, локализовать | redo | Штатная операция редактирования/окна/выхода; существующие guards остаются. |
| Edit / Cut | да | X / AX mask 0 | Оставить, локализовать | cut | Штатная операция редактирования/окна/выхода; существующие guards остаются. |
| Edit / Copy | да | C / AX mask 0 | Оставить, локализовать | copy | Штатная операция редактирования/окна/выхода; существующие guards остаются. |
| Edit / Paste | да | V / AX mask 0 | Оставить, локализовать | paste | Штатная операция редактирования/окна/выхода; существующие guards остаются. |
| Edit / Paste and Match Style | да | V / AX mask 3 | Оставить, локализовать | pasteAndMatchStyle | Штатная операция редактирования/окна/выхода; существующие guards остаются. |
| Edit / Delete | да | — | Оставить, локализовать | delete | Штатная операция редактирования/окна/выхода; существующие guards остаются. |
| Edit / Select All | да | A / AX mask 0 | Оставить, локализовать | selectAll | Штатная операция редактирования/окна/выхода; существующие guards остаются. |
| Edit / Substitutions | да | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Edit / Substitutions / Show Substitutions | да | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Edit / Substitutions / Smart Quotes | да | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Edit / Substitutions / Smart Dashes | да | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Edit / Substitutions / Text Replacement | да | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Edit / Speech | да | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Edit / Speech / Start Speaking | да | — | Оставить, локализовать | startSpeaking | Штатная операция редактирования/окна/выхода; существующие guards остаются. |
| Edit / Speech / Stop Speaking | да | — | Оставить, локализовать | stopSpeaking | Штатная операция редактирования/окна/выхода; существующие guards остаются. |
| Edit / AutoFill | да | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Edit / AutoFill / Contact… | нет | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Edit / AutoFill / Passwords… | нет | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Edit / AutoFill / Credit Card… | нет | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Edit / Start Dictation… | да | 🎤 / AX mask 8 | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Edit / Emoji & Symbols | да | E / AX mask 24 | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| View | да | — | Оставить, локализовать | OS-generated submenu/action | Раздел навигации native-меню. |
| View / Reload | да | R / AX mask 0 | Убрать из release | OS-generated submenu/action | Отладка/перезагрузка не нужна в пользовательском конвейере; reload может затронуть несохранённый редактор. |
| View / Force Reload | да | R / AX mask 1 | Убрать из release | OS-generated submenu/action | Отладка/перезагрузка не нужна в пользовательском конвейере; reload может затронуть несохранённый редактор. |
| View / Toggle Developer Tools | да | I / AX mask 2 | Убрать из release | OS-generated submenu/action | Отладка/перезагрузка не нужна в пользовательском конвейере; reload может затронуть несохранённый редактор. |
| View / Actual Size | да | 0 / AX mask 0 | Оставить, локализовать | resetZoom | Штатная операция редактирования/окна/выхода; существующие guards остаются. |
| View / Zoom In | да | + / AX mask 0 | Оставить, локализовать | zoomIn | Штатная операция редактирования/окна/выхода; существующие guards остаются. |
| View / Zoom Out | да | - / AX mask 0 | Оставить, локализовать | zoomOut | Штатная операция редактирования/окна/выхода; существующие guards остаются. |
| View / Toggle Full Screen | да | F / AX mask 24 | Оставить, локализовать | togglefullscreen | Штатная операция редактирования/окна/выхода; существующие guards остаются. |
| Window | да | — | Оставить, локализовать | OS-generated submenu/action | Раздел навигации native-меню. |
| Window / Minimize | да | M / AX mask 0 | Оставить, локализовать | minimize | Штатная операция редактирования/окна/выхода; существующие guards остаются. |
| Window / Minimise All | да | M / AX mask 2 | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Window / Zoom | да | — | Оставить, локализовать | zoom | Штатная операция редактирования/окна/выхода; существующие guards остаются. |
| Window / Zoom All | да | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Window / Fill | да | F / AX mask 28 | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Window / Centre | да | C / AX mask 28 | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Window / Enter Full Screen | да | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Window / Move & Resize | да | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Window / Move & Resize / Halves | нет | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Window / Move & Resize / Left | нет | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Window / Move & Resize / Right | нет | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Window / Move & Resize / Top | нет | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Window / Move & Resize / Bottom | нет | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Window / Move & Resize / Quarters | нет | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Window / Move & Resize / Top Left | нет | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Window / Move & Resize / Top Right | нет | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Window / Move & Resize / Bottom Left | нет | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Window / Move & Resize / Bottom Right | нет | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Window / Move & Resize / Arrange | нет | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Window / Move & Resize / Left & Right | нет | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Window / Move & Resize / Left & Quarters | нет | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Window / Move & Resize / Right & Left | нет | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Window / Move & Resize / Right & Quarters | нет | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Window / Move & Resize / Top & Bottom | нет | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Window / Move & Resize / Top & Quarters | нет | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Window / Move & Resize / Bottom & Top | нет | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Window / Move & Resize / Bottom & Quarters | нет | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Window / Move & Resize / Quarters | нет | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Window / Move & Resize / Return to Previous Size | нет | R / AX mask 28 | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Window / Full-Screen Tile | нет | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Window / Bring All to Front | да | — | Оставить, локализовать | front | Штатная операция редактирования/окна/выхода; существующие guards остаются. |
| Window / Arrange in Front | да | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Window / Remove Window from Set | да | — | Оставить: native OS | OS-generated submenu/action | Системное контекстное действие; не дублировать собственным обработчиком. |
| Window / Pi Studio — видеостудия | да | — | Переименовать | OS-generated submenu/action | Window title получает позиционирование харнеса конвейерных производств. |

## Итоговая структура source alpha.78

| Раздел | macOS | Windows x64 |
|---|---|---|
| Pi Studio | О программе; Проверить обновления…; Службы; Скрыть/Скрыть остальные/Показать все; Завершить | Отдельного application menu нет |
| Файл | Закрыть окно | Закрыть окно; Выход |
| Правка | Undo/Redo; Cut/Copy/Paste/Paste and Match Style/Delete/Select All; native Speech + дополнения ОС | Undo/Redo; Cut/Copy/Paste/Paste and Match Style/Delete/Select All |
| Вид | Реальный размер; Zoom +/-; Fullscreen | Те же native роли |
| Окно | Minimize; Zoom; Bring All to Front + дополнения ОС | Minimize |
| Справка | Сообщить о проблеме (фиксированный GitHub issues URL) | Проверить обновления…; Сообщить о проблеме; О программе |

Стандартные сочетания назначает Electron/ОС по native roles; код не перехватывает Clipboard и не подменяет безопасный Quit. Фоновая проверка не открывает окно результата. Ручной пункт поднимает существующее окно Studio и использует тот же main updater: свежая/coalesced проверка, проверяем/актуальная версия/offer/error, повтор без согласия на download. Во время согласованной загрузки показывает её прогресс, не запускает второй цикл. One-use token подтверждается renderer и не переигрывается при следующем окне. Установка по-прежнему требует «Обновить».

## Проверки и пределы

Pure-template tests отдельно для обеих ОС: ровно один manual action в нужном разделе, сохранены editing/window/quit roles, нет release reload/devtools/library. Unit tests actual NativeUpdates/Coordinator с controlled transport проверяют fresh-before-hour/coalescing/token ACK/error/no implicit download/busy operation. Actual native offscreen App проверяет MenuItem → настоящий main controller → честное сообщение development runtime, не ложную актуальную версию. Provider/preload UI fixture проверяет checking/current/error/retry, включая ошибку со старым offer: retry только проверяет. Это не real GitHub/platform acceptance.

MENU-01/UPD-04 остаются открыты до сверки реально упакованной .78 и реальных действий/keyboard states на macOS/Windows. Apple global menu/пользовательские Services, внешние программы и данные не менялись. Документ фиксирует source-решения; пользовательская .77 не заменялась этим этапом.
