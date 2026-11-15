# Материалы страницы Pi Studio

- `cover.svg` — оригинальная обложка в графитовых, белых и жёлтых цветах. `cover_preview.png` получен через CairoSVG; выполнены два render/view цикла навыка svg-creator. Обложка — иллюстрация, не макет интерфейса.
- `projects.png`, `agents.png`, `project.png`, `team-transfer.png` — снимки настоящего native main/preload/renderer alpha.72. Данные явно созданы для документации через native IPC в отдельной временной студии. На старте отдельно проверены ноль команд и ноль ordinary agents.
- Переснять: `npm run build`, затем `npx electron scripts/capture-readme.cjs`. Анимация: `python3 scripts/render-readme-gif.py` (Pillow). QA использует scripts/offscreen-main.cjs, accessory policy, отдельные userData/студию, mute audio и отказ вместо native unsaved-state dialog. Пользовательская студия и работающая установленная программа не изменяются; запросы модели и Terminal не запускаются.
- Входящие в веб-макет персонажи, локации и их provenance сохраняются отдельно в public; эти скриншоты не означают наличие предустановленных материалов в native-приложении.

- `viewer.png` — исходный настоящий снимок `artifacts/voice-workflow/studio-viewer.png` из изолированной проверки bundled Remotion Player от 15 ноября 2026. Источник содержимого — прежний QA-проект, не пользовательская рабочая студия. В текущем проходе не запускались генерация или звук.
- `walkthrough.gif` — последовательность указанных снимков; сохраняется пропорция каждого кадра. Это обзор интерфейса на разных QA-данных, не непрерывная запись работы модели.
