<p align="center"><strong>English</strong> · <a href="CONNECTIONS.md">Русский</a></p>

# Pi Studio connections

Each agent has its own connection, model and reasoning level. Studio uses the Pi 1.5.2 catalog, the bundled Claude Code extension and installed native Pi extensions.

## Sign-in methods

| Connection | How it works |
|:---|:---|
| OpenAI Codex | Sign in through ChatGPT. Available models and limits depend on your account and plan. |
| Claude Code | The official CLI and its subscription sign-in. Studio bundles the extension; the CLI is installed separately. Uses the CLI's shared sign-in. |
| GitHub Copilot | Native GitHub sign-in, subject to Pi and account capabilities. |
| Direct providers, aggregators and clouds | API key, OAuth, environment variables or cloud credentials, depending on the provider. |
| Compatible API or local server | An explicit server address, model list and OpenAI Completions or Responses protocol. Supports API-key authentication or no authentication. |

Studio does not choose an account or model for you, and does not automatically fall back to a paid API after an error or quota limit.

Available models and sign-in methods depend on the provider, Pi version and account permissions. A catalog entry does not mean every external account or plan has been tested. Actual Claude Code subscription-quota billing still needs separate validation; a model listing, successful sign-in or Pi cost estimate does not establish it.

## All built-in providers

43 providers from the Pi 1.5.2 catalog. The list is checked against Pi itself without model requests or reading user credentials.

| | Provider | ID |
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

Claude Code (`claude-code`) is an additional bundled Studio extension. Pi extensions can add more providers.

## Browser and Computer Use

**Browser Use:** a separate browser with a profile tied to the Pi conversation. Supports screenshots, tabs, clicks, text input, uploading project files and saving downloads as results. Components are installed through an explicit action. These are Studio visual tools based on agent-browser, rather than the browser-use package.

**Computer Use:** desktop application tools for window screenshots, clicks, input, keys and scrolling. On macOS, Accessibility and Screen Recording permissions are required; fully restart Studio after changing them. Permission requests require an explicit user action. Transport and status handling have been tested; full operation with real windows and granted permissions still needs separate acceptance.

Both tools require the selected model to support images. No additional model is connected automatically. Native operation on Windows still needs validation; the Windows build remains a preview.

**The team MCP server:** explicitly assigned and scoped to the current project and team. An agent can find a teammate, send a task, wait for completion, read settings without secrets and access result files. If the recipient asks a question, encounters an error or has an uncertain outcome, dependent work must stop. It does not grant access to arbitrary profiles or computer settings.

[Back to Pi Studio](../README.md)
