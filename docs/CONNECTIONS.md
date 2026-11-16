<p align="center"><a href="CONNECTIONS.en.md">English</a> · <strong>Русский</strong></p>

# Подключения Pi Studio

Для каждого агента отдельно выбираются подключение, модель и уровень рассуждения. Studio использует каталог Pi 1.5.2, встроенное расширение Claude Code и установленные расширения самого Pi.

## Способы входа

| Подключение | Как работает |
|:---|:---|
| OpenAI Codex | Вход через ChatGPT. Доступные модели и лимиты зависят от аккаунта и тарифа. |
| Claude Code | Официальный CLI и его подписочный вход. Расширение включено в Studio; CLI устанавливается отдельно. Используется общий вход CLI. |
| GitHub Copilot | Штатный вход через GitHub по возможностям Pi и аккаунта. |
| Прямые провайдеры, агрегаторы, облака | API-ключ, OAuth, переменные окружения или облачные настройки — в зависимости от конкретного провайдера. |
| Совместимый API или локальный сервер | Явный адрес сервера, список моделей и OpenAI Completions либо Responses. Поддерживаются API-ключ и работа без авторизации. |

Studio не выбирает аккаунт или модель за пользователя и не переходит автоматически на платный API при ошибке или исчерпании квоты.

Конкретные модели и методы входа зависят от провайдера, версии Pi и прав аккаунта. Наличие подключения в каталоге не означает, что все внешние аккаунты и тарифы проверены. Реальный расход подписочной квоты Claude Code ещё требует отдельной проверки; наличие модели, успешный вход или оценка стоимости Pi этого не доказывают.

## Все встроенные провайдеры

43 провайдера из каталога Pi 1.5.2. Список сверяется с самим Pi, без запросов к моделям и без чтения пользовательских credentials.

| | Провайдер | ID |
|---:|:---|:---|
| 1 | Amazon Bedrock | `amazon-bedrock` |
| 2 | Ant Ling | `ant-ling` |
| 3 | Anthropic | `anthropic` |
| 4 | Azure | `azure` |
| 5 | Baseten | `baseten` |
| 6 | Cerebras | `cerebras` |
| 7 | Cloudflare AI Gateway | `cloudflare-ai-gateway` |
| 8 | Cloudflare Workers AI | `cloudflare-workers-ai` |
| 9 | DeepSeek | `deepseek` |
| 10 | Fireworks | `fireworks` |
| 11 | GitHub Copilot | `github-copilot` |
| 12 | Google | `google` |
| 13 | Google Vertex AI | `google-vertex` |
| 14 | Groq | `groq` |
| 15 | Hugging Face | `huggingface` |
| 16 | Kimi For Coding | `kimi-coding` |
| 17 | Meta | `meta` |
| 18 | MiniMax | `minimax` |
| 19 | MiniMax CN | `minimax-cn` |
| 20 | Mistral | `mistral` |
| 21 | Moonshot AI | `moonshotai` |
| 22 | Moonshot AI CN | `moonshotai-cn` |
| 23 | NVIDIA | `nvidia` |
| 24 | OpenAI | `openai` |
| 25 | OpenAI Codex | `openai-codex` |
| 26 | OpenCode Zen | `opencode` |
| 27 | OpenCode Go | `opencode-go` |
| 28 | OpenRouter | `openrouter` |
| 29 | Qwen Token Plan | `qwen-token-plan` |
| 30 | Qwen Token Plan CN | `qwen-token-plan-cn` |
| 31 | Qwen Token Plan Individual | `qwen-token-plan-individual` |
| 32 | Qwen Token Plan Individual CN | `qwen-token-plan-individual-cn` |
| 33 | Radius | `radius` |
| 34 | Together | `together` |
| 35 | TypeSafe | `typesafe` |
| 36 | Vercel AI Gateway | `vercel-ai-gateway` |
| 37 | xAI | `xai` |
| 38 | Xiaomi | `xiaomi` |
| 39 | Xiaomi Token Plan AMS | `xiaomi-token-plan-ams` |
| 40 | Xiaomi Token Plan CN | `xiaomi-token-plan-cn` |
| 41 | Xiaomi Token Plan SGP | `xiaomi-token-plan-sgp` |
| 42 | Z.AI | `zai` |
| 43 | Z.AI Coding CN | `zai-coding-cn` |

Claude Code (`claude-code`) подключён дополнительно как встроенное расширение Studio. Расширения Pi могут добавлять других провайдеров.

## Браузер и Computer Use

**Browser Use:** отдельный браузер с профилем диалога Pi. Поддерживаются снимки, вкладки, клики, ввод текста, загрузка файлов проекта и сохранение скачанных файлов в результаты. Компоненты устанавливаются отдельным явным действием. Это визуальные инструменты Studio на базе agent-browser, а не пакет browser-use.

**Computer Use:** инструменты управления приложениями через снимки окон, клики, ввод, клавиши и прокрутку. На macOS требуются разрешения Accessibility и Screen Recording; после их изменения нужен полный перезапуск Studio. Разрешения выдаются через явное действие пользователя. Транспорт и статусы проверены; полноценная работа с реальными окнами и выданными разрешениями ещё требует отдельной приёмки.

Обоим инструментам нужна выбранная модель с поддержкой изображений. Дополнительная модель автоматически не подключается. Нативная работа на Windows ещё требует проверки; Windows-сборка остаётся preview.

**MCP team:** назначается явно и работает в пределах текущего проекта и команды. Агент может найти участника, отправить поручение, дождаться завершения, прочитать настройки без секретов и файлы результатов. Если получатель задаёт вопрос, возникает ошибка или результат неопределён, зависимая работа должна остановиться. Это не доступ к произвольным профилям или настройкам компьютера.

[Вернуться к Pi Studio](../README.ru.md)
