# Встроенные обновления: реализация и выпуск

Статус 16 ноября 2026: реализованы проверяемое ядро UPD-01/03, координатор safe-state и UI-компоненты UPD-02. Установщик, health/rollback, подключение lifecycle/верхнего меню и сквозная приёмка остаются следующими задачами. Компоненты проверены отдельно, но не подключены к работающему приложению: не показываем предложение без готового установщика. Это не инструкция о готовом автообновлении alpha.74.

## Доверие к релизу

Файл `Pi-Studio-<version>-<darwin|win32>-<arm64|x64>.update.json` содержит `{payload, signature}`. Оба значения — canonical base64. Ed25519 подписывает исходные байты JSON payload, а не пересобранный объект. Публичная идентичность закреплена в `src/main/updates/publicKey.json`. Приватный ключ создаётся отдельно с правами 0600 вне репозитория, никогда не попадает в приложение, студию или release assets. Инициализация отказывается перезаписывать обе идентичности; смена ключа требует отдельной миграции доверия установленных версий.

Подписаны schema/app ID, точная SemVer, платформа/архитектура, минимальная ОС, формат установки, source commit и имя/байты/SHA-256/распакованный размер ZIP. URL внутри payload не допускаются. GitHub-адрес строится только для `vtlk/pi-studio` и ожидаемого имени. Один SHA-256 из GitHub или соседнего `.sha256` не авторизует установку.

Проверка anonymous: без PAT, cookies, credentials или данных студии. В private-репозитории настоящий запрос сейчас получает 404 и понятный unavailable-результат. Это не повод встраивать токен владельца или менять видимость репозитория до REL-04. Неподписанные старые релизы не предлагаются для автоустановки.

## Подготовка метаданных

Одноразовая инициализация на машине выпуска:

```sh
npm run release:sign -- init "$HOME/.config/pi-studio/release-signing/update-ed25519.pem"
```

В текущем проекте идентичность уже создана. Повторять init или генерировать другой ключ не нужно. В коммите находится только публичный ключ.

При упаковке установить `PI_STUDIO_UPDATE_SIGNING_KEY` в абсолютный путь внешнего ключа; Mac также требует прежний `PI_STUDIO_SIGN_IDENTITY`. Оба упаковщика тогда проверяют структуру ZIP и автоматически создают `.update.json`. Подпись метаданных не заменяет Apple code signing/notarization или Windows Authenticode и не означает завершённую платформенную приёмку. Опубликовать ZIP и соответствующий update JSON в одном release/tag/source commit. До завершения installer не объявлять релиз готовым к автообновлению.

Отдельное подписание уже проверенного архива текущей версии:

```sh
PI_STUDIO_UPDATE_SIGNING_KEY="$HOME/.config/pi-studio/release-signing/update-ed25519.pem" \
  npm run release:sign -- sign dist/Pi-Studio-VERSION-mac-arm64.zip darwin arm64 13.0.0 FULL_SOURCE_COMMIT
```

Нельзя подписывать неизвестные сборки или тестовые фиктивные приложения production-ключом. Тесты используют отдельные эфемерные ключи; приватные значения не печатаются.

## Проверки ядра

- `UpdateSchedule`: старт, 60 минут и wake используют единственную проверку, без очереди пропущенных часов. На сетевую ошибку — один отложенный повтор; Retry-After действует и для ручных повторов. Закрытие отменяет запрос и игнорирует поздний результат.
- GitHub selection: только published releases, строгий SemVer и нужный канал, подходящие OS/arch/min OS, подписанные метаданные и фактически присутствующий согласованный ZIP. Отбор не зависит от порядка ответа API. Проверка не скачивает ZIP.
- Загрузка после явного выбора: повторная проверка метаданных, лимит свободного места, streaming/hash/точный размер, HTTPS/ограниченные redirects и `wx` для собственного staging. Ошибка/отмена удаляет только созданный этой операцией файл.
- До распаковки проверяются центральные и локальные заголовки, размеры, имена/коллизии/специальные файлы, Windows reserved paths и полная форма приложения. Mac framework symlinks допустимы только внутри приложения, без cycles/dangling links и записей под symlink. Проверяющий модуль ничего не распаковывает и не запускает.
- Mac ZIP теперь использует `--norsrc --noextattr`, чтобы лишний `__MACOSX` не попадал в пакет. Старую подписанную .74 read-only переупаковали этими флагами и проверили: 1157 entries / 318205891 unpacked bytes. Настоящий Windows preview .73: 632 entries / 411226741 bytes. Временный тестовый ZIP удалён; приложение и данные не менялись.

268 unit/FS, typecheck/lint/architecture проходят. Доказательство структуры — `artifacts/update-archives-proof.json`. Эти проверки не равны установке N→N+1 из GitHub, нативному Windows запуску или готовым UPD-01–03.

## Координатор и UI: следующий проверенный этап

`UpdateCoordinator` связывает одно явное согласие с актуальным релизом, одним download/prepare и точным одноразовым подтверждением сохранения. Несохранённый/пропавший renderer, новая работа во время flush, активные Pi/chain/native операции, stale nonce и отменённый выход не допускают commit/quit. При ошибке сначала подтверждается отмена helper и только затем снимается блокировка; неопределённая отмена сохраняет защиту. Коммит перед выходом ещё не означает, что старый процесс завершился или пакет установлен: это обязанность платформенного helper.

Обычные native IPC проходят общий InvocationGate. Updater control endpoints выделены отдельно, чтобы saved acknowledgement оставался доступен при блокировке. RunHost допускает только idle cleanup, блокирует новые запросы с production transport и может снова открывать точный диалог после отмены обновления. Активные цепочки блокируют update; orphan token закрытого Pi не считается активной работой и инвалидируется при захвате. BrowserAuth/Startup/team имеют отдельные проверки незавершённой работы. Эти guards готовы для связывания в main; сама блокировка пока не запрашивается работающим приложением.

UI использует общий IconButton/instant Tooltip/Modal: отсутствие offer скрывает Download, «Позже» не скачивает, запрос показывает прогресс/ошибку/повтор. На время exact saved acknowledgement рабочая область должна быть inert, окно установки остаётся доступным и недисмиссимым. Перед подтверждением вызывается saveNow; открытый сторонний диалог/несохранённое поле секрета не дают ready. Уполномоченная ошибка остаётся видимой после снятия блокировки. UI-черновики вне очереди автосохранения также должны быть проверены при общей интеграции.

`npm run test:updates-ui` строит отдельный fixture renderer и использует настоящий provider/shared UI/production preload в accessory offscreen Electron. Проверены клавиатурное открытие через Chromium focus emulation (без фокуса ОС), отсрочка без download, один запрос, progress/error, draft dialog, nonce flush, inert и Escape. Источник состояний — явно controlled fixture, не настоящий updater/installer. `artifacts/update-ui-proof.json`.

Последний результат: 276 unit/FS, сборка/typecheck/lint/architecture (393 modules), native constructor CRUD + separate-process persistence и native Quit проходят. `artifacts/update-coordinator-proof.json` отделяет эти результаты от пока отсутствующих installer/lifecycle/реального GitHub-to-installed-app цикла. Общий статус UPD-01–03 остаётся частичным.

Первичные источники: [GitHub Releases API](https://docs.github.com/en/rest/releases/releases#list-releases), [Electron autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater), [Node crypto.verify](https://nodejs.org/api/crypto.html#cryptoverifyalgorithm-data-key-signature), [node-semver](https://github.com/npm/node-semver), [yauzl](https://github.com/thejoshwolfe/yauzl).
