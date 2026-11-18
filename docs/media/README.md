# Pi Studio GitHub media

## Current screenshots

Eight screenshots from the current native main/preload/renderer, in dark mode. Each README uses screenshots captured in its own language, including project names, agent names, instructions and sample documents.

| View | English | Русский |
|:---|:---|:---|
| Landing-page project, open chat and process list | [Project](en/project.png) | [Проект](ru/project.png) |
| Browser result in an agent chat | [Browser](en/browser.png) | [Браузер](ru/browser.png) |
| Agent prompt editor | [Agents](en/agents.png) | [Агенты](ru/agents.png) |
| Repeated projects for different companies | [Projects](en/projects.png) | [Проекты](ru/projects.png) |

All three demonstration projects are **landing pages for different companies**: QUIT.BAT, Forma and Flowdesk. Each uses the same team and ordered five-agent pipeline. Projects are created through actual native IPC in isolated temporary studios. Conversations, model selection, readiness, session bindings, agent statuses and process-list entries are controlled documentation fixtures; their PIDs are illustrative and do not represent running Pi sessions. The browser image is a real offscreen Chromium capture of the public https://quitbat.work/ homepage, loaded with matching English or Russian language preferences in a fresh, memory-only browser session. No personal browser or signed-in account is accessed. Only requests to quitbat.work are allowed. It is not preinstalled content or a claim of completed model work.

The source UI, field geometry, file browser and Markdown previews are actual app captures. The prompt editor stays within the visible viewport, with its footer and a 20px bottom margin. This is checked at 1080×720 and 1440×900 in both languages; keyboard resizing and opening/closing field search are also checked.

## macOS presentation

The PNGs have a transparent background, rounded window corners and a small, symmetric yellow glow on every side. `scripts/frame-readme.swift` adds a **presentation frame** around the actual renderer capture. Its three traffic-light controls use the same `{x: 20, y: 20}` location as the app's `hiddenInset` macOS window. These controls are decoration for documentation, not a claim that an OS window frame was captured by `webContents`.

The application UI pixels are not generated, retouched or translated inside an image; fixture data is rendered by the actual app components. Language and theme are set through the app's isolated native preferences before loading it. No AI image generation is used for screenshots. The shared illustrated cover remains separate from screenshots.

## Reproduce on macOS

Requires Node dependencies, an Electron runtime, the Xcode command-line Swift compiler (AppKit) and access to the public quitbat.work site. `PI_STUDIO_CAPTURE_ELECTRON` can select an existing isolated Electron executable; `PI_STUDIO_QA_MAIN` can select a separately compiled native entry.

```sh
npm run build
node scripts/capture-readme.cjs
```

The runner uses `scripts/offscreen-main.cjs`, accessory activation policy, hidden Electron windows, temporary userData/studios and muted audio. It blocks agent/Terminal launches, external-browser opening, sign-in, installation and OS dialogs. It waits for saved state before reload/capture. Owned windows/processes and temporary staging are cleaned up; the installed app, user projects, dialogues, credentials, browser profiles and OS focus are preserved.

A before/after read-only Chrome clone audit is recorded locally. New retained clones fail the capture and require review; the script never deletes or infers ownership of them.

Dimensions, hashes, source main hash, language/theme, public-site title/heading and prompt geometry are recorded in [screenshots-proof.json](screenshots-proof.json).

## Illustrations and older media

`cover.png` and `workflow.png` were made with the built-in image_gen tool on 16 November 2026. The cover was subsequently localized to English: **PI STUDIO**, **Agent Pipeline**, **Prompts · Tools · Files**. The workflow illustration retains its Russian labels. These are illustrations, not screenshots. See [prompts](generation-prompts.md) and [generation metadata](generation-proof.json).

Earlier root-level UI images and walkthrough media are historical and are not referenced by the current English or Russian README. User source materials outside this repository are not changed by this capture workflow.
