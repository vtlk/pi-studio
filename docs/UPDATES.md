# Встроенные обновления: реализация и выпуск

Статус 16 ноября 2026: ядро, concrete installer/helper и startup health теперь связаны с main lifecycle, узким IPC и верхним меню в исходниках после alpha.75. Подключены сохранение/idle admission, блокировка нового ввода, точное восстановление студии/экрана, отказ выхода при неопределённой отмене и очистка завершённых транзакций/оборванных загрузок. 302 unit/FS и отдельные native UI/Quit проверки проходят. Настоящий GitHub → установленная N+1 цикл, сборка с этой интеграцией и нативная Windows-приёмка ещё открыты. Установленная alpha.75 этих новых изменений не содержит; готовое автообновление для неё не заявляется. Предыдущие разделы сохраняют результаты промежуточных этапов.

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

## Координатор и UI: промежуточный этап source alpha.75

`UpdateCoordinator` связывает одно явное согласие с актуальным релизом, одним download/prepare и точным одноразовым подтверждением сохранения. Несохранённый/пропавший renderer, новая работа во время flush, активные Pi/chain/native операции, stale nonce и отменённый выход не допускают commit/quit. При ошибке сначала подтверждается отмена helper и только затем снимается блокировка; неопределённая отмена сохраняет защиту. Коммит перед выходом ещё не означает, что старый процесс завершился или пакет установлен: это обязанность платформенного helper.

Обычные native IPC проходят общий InvocationGate. Updater control endpoints выделены отдельно, чтобы saved acknowledgement оставался доступен при блокировке. RunHost допускает только idle cleanup, блокирует новые запросы с production transport и может снова открывать точный диалог после отмены обновления. Активные цепочки блокируют update; orphan token закрытого Pi не считается активной работой и инвалидируется при захвате. BrowserAuth/Startup/team имеют отдельные проверки незавершённой работы. Эти guards готовы для связывания в main; сама блокировка пока не запрашивается работающим приложением.

UI использует общий IconButton/instant Tooltip/Modal: отсутствие offer скрывает Download, «Позже» не скачивает, запрос показывает прогресс/ошибку/повтор. На время exact saved acknowledgement рабочая область должна быть inert, окно установки остаётся доступным и недисмиссимым. Перед подтверждением вызывается saveNow; открытый сторонний диалог/несохранённое поле секрета не дают ready. Уполномоченная ошибка остаётся видимой после снятия блокировки. UI-черновики вне очереди автосохранения также должны быть проверены при общей интеграции.

`npm run test:updates-ui` строит отдельный fixture renderer и использует настоящий provider/shared UI/production preload в accessory offscreen Electron. Проверены клавиатурное открытие через Chromium focus emulation (без фокуса ОС), отсрочка без download, один запрос, progress/error, draft dialog, nonce flush, inert и Escape. Источник состояний — явно controlled fixture, не настоящий updater/installer. `artifacts/update-ui-proof.json`.

Последний результат: 276 unit/FS, сборка/typecheck/lint/architecture (393 modules), native constructor CRUD + separate-process persistence и native Quit проходят. `artifacts/update-coordinator-proof.json` отделяет эти результаты от пока отсутствующих installer/lifecycle/реального GitHub-to-installed-app цикла. Общий статус UPD-01–03 остаётся частичным.

Первичные источники: [GitHub Releases API](https://docs.github.com/en/rest/releases/releases#list-releases), [Electron autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater), [Node crypto.verify](https://nodejs.org/api/crypto.html#cryptoverifyalgorithm-data-key-signature), [node-semver](https://github.com/npm/node-semver), [yauzl](https://github.com/thejoshwolfe/yauzl).


## Установщик и подтверждение запуска: исходники после alpha.75

`NativeUpdateInstaller` повторно проверяет hash/размер пакета, платформу/версию, место на томе приложения, отсутствие пользовательских папок внутри заменяемой программы и опись файлов. Распаковка проверяет CRC каждого файла, создаёт только обычные файлы, а разрешённые внутренние Mac symlink — последними. Затем проверяются версия/идентификатор/архитектура и постоянный OS publisher: на Mac deep/strict codesign + designated requirement, на Windows PE x64 и сохранение существующего Authenticode publisher. Неподписанный Windows preview не становится Authenticode-подписанным от проверки Ed25519.

Опись создаётся упаковщиками и защищает дополнительные пользовательские файлы от замены. На Mac сначала создаются все nested signatures, затем записывается полная опись и повторно подписывается внешний bundle. Все signature paths учитываются; байты ресурсов проверяет codesign. Windows опись также содержит SHA-256 файлов. Перед arm/commit и после фактического выхода старой программы опись проверяется заново; перенос выбранной студии внутрь программы запрещает установку. Alpha.75 ещё не содержит опись: первый релиз с updater потребуется установить штатным существующим установщиком, не пытаться автоматически заменять старую неопознанную папку.

Отдельные runner/worker используют private Node вне заменяемой программы. При наличии переиспользуется поддерживаемый Node Pi; иначе предусмотрена загрузка только официального Node 22.22.1 с закреплённым hash, без установки npm/Pi. Staging находится рядом с программой, имеет 0700 / ограниченную Windows DACL и содержит только программу/helper/служебный протокол. UserData и студия не копируются. Durable journal и одноразовый nonce связывают конкретную установку, пути, версии и inode/birthtime каталогов.

Helper ждёт и commit, и реальное завершение старого PID. Затем переносит старую программу во временную транзакционную папку, ставит новую и запускает точный executable без shell. Успех требует health от PID именно запущенного процесса; после этого прежняя программа удаляется. При сбое запуска/отсутствии health новый frozen-процесс получает запрос штатно закрыться и старая программа возвращается. Worker crash покрывается supervisor и журналом. Неизвестная папка на месте приложения не удаляется; зависший процесс не убивается, прежняя программа сохраняется с recovery-required. Одновременный сбой всех наблюдателей/питания и полный OS-recovery ещё требуют проверки.

`UpdateStartup` проверяет exact journal/active pointer/путь executable/идентичность и версию программы до принятия служебного userData override. До явного readiness он не пишет health. PID marker сохраняется до реального выхода, чтобы rollback не двигал ещё работающую программу. Открытие уже committed/восстановленной версии не требует нового health и не отправляет сообщений Pi. Этот модуль ещё предстоит связать с настоящими main/renderer gates, безопасной отменой Quit и очисткой результата.

Проверки: helper действительно меняет/возвращает только инертные программы в собственных временных папках, в том числе после SIGKILL своего тестового worker, потери health, зависания и позднего добавления пользовательского файла. Это реальные файловые операции/процессы, но не запуск Studio или нативная Windows-приёмка. Отдельно настоящий подписанный ZIP .75 распакован production-кодом: Ed25519/SHA/CRC/symlink/modes и deep-strict Mac publisher/ID/arch проходят; копия немедленно удалена, установленное приложение/студия не менялись. Proof: `artifacts/update-extraction-proof.json`, `artifacts/update-installer-proof.json`. Общая GitHub → установленная N+1 приёмка остаётся открытой.


## Общая интеграция после alpha.75

`registerNativeUpdates` создаёт настоящий coordinator только в packaged macOS/Windows с текущими OS/arch/version и закреплённым public key. На старте/часовом таймере/wake он использует anonymous GitHub API; dev/изолированные raw-Electron запуски не скачивают релизы. Широкого URL/path/command IPC и GitHub PAT в поставке нет. Новая версия, неподтверждённый startup или API-проверка сами не отправляют сообщений Pi.

Перед commit общий IPC gate синхронно закрывает admission и берёт reversible holds всех трёх RunHost, затем паузу фонового числового учёта. Проверяются активные Pi/images/chains/team/OAuth/runtime/browser installs, ожидаются очереди учёта и сохранения main, закрываются только owned idle dialogues. Состояние перепроверяется перед arm и quit. На реальном Electron will-quit проверено: пока отмена helper не подтверждена, процесс остаётся жив и остальные контроллеры не закрываются; повторный выход выполняется после успешной отмены. Несохранённое окно при автоматической установке отменяет переход без native OS-попапа. Для этого поведения есть отдельная source/native проверка, а не утверждение о готовом OS update cycle.

`UpdateBootstrap` получает native lock до появления редактируемого кадра. После загрузки реальной студии `UpdatesProvider` восстанавливает один раз page/project ID только в совпадающей папке, отправляет hydrated/saved startup token и сохраняет рабочую область inert до authenticated commit. Автоматические legacy/info dialogs в первоначально frozen новой программе не содержат нового пользовательского черновика и не блокируют health. При обычном обновлении открытые редакторы/секреты и отдельный черновик пути студии блокируют сохранённую готовность. Повторное открытие окна или другая студия не переигрывают старую навигацию.

После health cleanup ждёт завершения helper, проверяет directory identities/inventory, сохраняет recovery copies и неизвестные файлы. Понятная ошибка очистки доступна в UI; явный повтор не скачивает обновление повторно. У оборванных загрузок проверяются own marker/PID, обычные файлы и точный download directory: живые и неизвестные данные сохраняются. Страховочная программа существует только до успешного старта; пользовательская студия/истории не копируются.

`npm run test:update-lifecycle-ui` использует полный production main/preload/renderer с отдельной реальной дисковой студией, но controlled update states. Проверены блокировка первого кадра, выбор более старого конкретного проекта, startup token/health readiness, отсутствие deadlock от автоматического диалога, выпуск только после commit, черновик папки и неизменность файлов проектов. Node parent подтверждает реальный exit и убирает QA profile после него; это устраняет пересоздание Chromium cache после удаления живого профиля. Один ранний тестовый процесс завис на выходе и был остановлен после проверки его точной принадлежности QA; текущие проверки с fail-safe deadline проходят. Ни установленная Studio, ни пользовательские процессы не останавливались.

`npm run test:update-quit` проверяет production close-admission на настоящем accessory Electron: ожидание, отказ отмены без drain/закрытия, повтор и фактический exit. Дополнительно native empty/legacy/missing-preload, обычный Quit (idle/native Computer status), constructor CRUD/Undo и separate-process persistence проходят. Proof: update-lifecycle-ui-proof.json, update-quit-proof.json, update-lifecycle-proof.json. Это не замена реальному GitHub N→N+1, signed packaged bootstrap/rollback и Windows циклу.


## Подписанные packaged Mac-программы: actual replacement и rollback

`PI_STUDIO_SIGN_IDENTITY=<existing certificate> node --experimental-strip-types scripts/smoke-packaged-update.ts /absolute/old/Pi\ Studio.app /absolute/new/Pi\ Studio.app success` проверяет реальную замену каталога, сохранение exact project, один UI consent, реальный exit/relaunch, health/cleanup и неизменность disk studio/preferences/dummy credential. Режим `no-health` подавляет только readiness новой программы и ждёт реальный production timeout 90 секунд: новая frozen-программа штатно закрывается, старая восстанавливается/открывается. Подпись/inventory повторно проверяются в результате; все собственные приложения и staging удаляются после actual exit.

Только temporary QA-копии получают test entry/accessory/offscreen policy и ephemeral public-key pin; неизменённая production логика координатора/установщика/helper/startup/renderer работает с controlled HTTPS release responses. Production private release key не используется для QA metadata. Pi startup/launch заблокированы; model/Terminal requests — 0. Это actual signed Mac cycle, но не проверка реального GitHub или native Windows/пользовательской установки. Proof: packaged-update-success-proof.json и packaged-update-no-health-proof.json. Нормальные success child-fixtures имеют 6 секунд на старт под нагрузкой полного parallel suite; negative fixtures сохраняют короткий timeout, production — 90 секунд.

Каноническая alpha.77 дополнительно проверена production extractor и OS publisher verification по установленному приложению без его замены. Сборка включает полный third-party notice collector для 128 renderer-пакетов и Electron/Chromium тексты Mac; missing notice запрещает build. Supplemental provenance и его limitation отражены в third-party-licenses/SOURCES.md. Наличие notices не объявляет весь distribution-rights audit завершённым.
