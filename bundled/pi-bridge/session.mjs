import { readFile, rm, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve, relative, isAbsolute } from 'node:path';
import { observeMcpTransport, waitForMcp } from './mcp-health.mjs';
import { createConnectionRuntime } from './connection-runtime.mjs';
import { classifyProviderFailure } from './provider-failure.mjs';
import { sessionSystemPrompt } from './prompt.mjs';
import { resolveAssignedPackages } from './packages.mjs';

export async function runSession(bootstrapPath) {
  const bootstrap = JSON.parse(await readFile(bootstrapPath, 'utf8'));
  await rm(bootstrapPath, { force: true });
  await rm(`${bootstrapPath}.command`, { force: true });
  const url = new URL(bootstrap.url);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    typeof bootstrap.token !== 'string'
  )
    throw new Error('Invalid Studio bridge');
  const headers = {
    Authorization: `Bearer ${bootstrap.token}`,
    'Content-Type': 'application/json',
  };
  async function request(path, data) {
    const response = await fetch(`${bootstrap.url}/${path}`, {
      headers,
      method: data === undefined ? 'GET' : 'POST',
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('Pi Studio session bridge disconnected');
    return response.json();
  }
  let queue = Promise.resolve();
  const event = (data) => {
    const result = queue.then(() => request('event', data));
    queue = result.catch(() => {});
    return result;
  };
  await event({ type: 'hello', pid: process.pid });
  const envelope = await request('context');
  const initialImages = [];
  for (const attachment of envelope.record.attachments ?? []) {
    if (!attachment.image) continue;
    const path = resolve(envelope.record.projectRoot, attachment.image.path);
    const rel = relative(envelope.record.projectRoot, path);
    if (
      isAbsolute(rel) ||
      rel.startsWith('..') ||
      !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(attachment.image.mimeType)
    )
      throw new Error('Invalid image reference');
    initialImages.push({
      type: 'image',
      mimeType: attachment.image.mimeType,
      data: (await readFile(path)).toString('base64'),
    });
  }
  const initialMessage =
    envelope.firstMessage &&
    envelope.firstMessage +
      (envelope.record.attachments?.length
        ? `\n\nInput files (paths relative to project directory): ${JSON.stringify(envelope.record.attachments)}\nUse assigned handlers for document/audio/video formats; report missing handlers explicitly. Never execute an attachment automatically.`
        : '');
  const sdk = await import(pathToFileURL(bootstrap.sdk).href);
  const { createDefaultTransport } = await import(
    new URL('./extensions/mcp/runtime.js', pathToFileURL(bootstrap.sdk)).href
  );
  const {
    SessionManager,
    SettingsManager,
    createMcpExtension,
    createCodemodeExtension,
    createToolSearchExtension,
    createAgentSessionRuntime,
    createAgentSessionServices,
    createAgentSessionFromServices,
    InteractiveMode,
    getAgentDir,
  } = sdk;
  process.chdir(envelope.record.cwd);
  const sessions = envelope.sessionPath
    ? envelope.fork
      ? SessionManager.forkFrom(
          envelope.sessionPath,
          envelope.record.cwd,
          envelope.record.sessionDirectory,
        )
      : SessionManager.open(envelope.sessionPath, envelope.record.sessionDirectory)
    : SessionManager.create(envelope.record.cwd, envelope.record.sessionDirectory);
  if (resolve(sessions.getCwd()) !== resolve(envelope.record.cwd))
    throw new Error('Pi session cwd differs; a supported fork is required');
  const statuses = new Map();
  const servers = [
    ...envelope.resources.mcpServers,
    {
      name: 'pi_studio',
      scope: 'extension',
      source: 'Pi Studio internal',
      config: {
        url: `${bootstrap.url}/mcp`,
        headers: { Authorization: `Bearer ${bootstrap.token}` },
        exposure: 'direct',
        timeout: 240,
      },
    },
  ];
  const requiredServers = servers.map((server) => server.name);
  let runtime,
    heartbeat,
    bindingTimer,
    closing = false,
    bound = false,
    binding = false;
  let failures = 0;
  async function bindWrittenSession() {
    if (bound || binding) return;
    binding = true;
    try {
      const path = sessions.getSessionFile();
      if (!path) return;
      try {
        await stat(path);
      } catch {
        return;
      }
      await event({ type: 'bound', sessionId: sessions.getSessionId(), sessionFile: path });
      bound = true;
    } finally {
      binding = false;
    }
  }
  async function close() {
    if (closing) return;
    closing = true;
    clearInterval(heartbeat);
    clearInterval(bindingTimer);
    await runtime?.dispose();
    await event({ type: 'stopped' }).catch(() => {});
  }
  const shutdown = () => {
    void close().finally(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGHUP', shutdown);
  try {
    const control = (pi) => {
      // Verified with the installed Pi Codex adapter and the user's subscription. No API fallback.
      if (envelope.record.model.provider === 'openai-codex') {
        pi.on('before_provider_request', (event) => {
          const payload = event.payload;
          payload.tools = [...(payload.tools ?? []), { type: 'web_search' }];
          return payload;
        });
      }
      pi.on('session_before_switch', () => ({ cancel: true }));
      pi.on('session_before_fork', () => ({ cancel: true }));
      pi.on('input', async (input, ctx) => {
        try {
          await waitForMcp(statuses, requiredServers);
        } catch (error) {
          ctx.ui.notify(error.message, 'error');
          await event({ type: 'error' });
          return { action: 'handled' };
        }
        try {
          await event({ type: 'request', message: input.text });
        } catch {
          ctx.ui.notify(
            'Другой этап проекта ещё работает или связь со Studio недоступна. Запрос не отправлен. Повторите после его завершения.',
            'error',
          );
          return { action: 'handled' };
        }
        return { action: 'continue' };
      });
      pi.on('agent_start', async () => {
        await event({ type: 'running' });
      });
      pi.on('agent_settled', async (settled, ctx) => {
        await bindWrittenSession();
        const last = runtime.session.messages.findLast((message) => message.role === 'assistant');
        await event({
          type: 'settled',
          ...(last?.stopReason === 'error' ? { failure: classifyProviderFailure(last.errorMessage) } : {}),
          outcome: settled.aborted
            ? 'aborted'
            : last?.stopReason === 'error'
              ? 'error'
              : 'completed',
        });
      });
    };
    const settings = SettingsManager.inMemory({
      packages: [],
      extensions: [],
      skills: [],
      prompts: [],
    });
    const factory = async ({ cwd, sessionManager, sessionStartEvent }) => {
      if (
        resolve(cwd) !== resolve(envelope.record.cwd) ||
        sessionManager.getSessionFile() !== sessions.getSessionFile()
      )
        throw new Error('Studio owns the single bound dialogue');
      const packages = await resolveAssignedPackages(
        sdk,
        cwd,
        settings,
        envelope.resources.plugins,
      );
      await event({ type: 'capabilities', executableExtensions: packages.extensions.length > 0 });
      const services = await createAgentSessionServices({
        cwd,
        ...(envelope.modelAuth ? { modelRuntime: await createConnectionRuntime(sdk, envelope.modelAuth) } : {}),
        settingsManager: settings,
        resourceLoaderOptions: {
          noExtensions: true,
          noSkills: true,
          noPromptTemplates: true,
          noThemes: true,
          noContextFiles: true,
          additionalExtensionPaths: packages.extensions,
          additionalSkillPaths: [
            ...packages.skills,
            ...envelope.resources.skills.map((item) => item.path),
          ],
          additionalPromptTemplatePaths: packages.prompts,
          additionalThemePaths: packages.themes,
          appendSystemPrompt: [sessionSystemPrompt(envelope)],
          extensionFactories: [
            control,
            // The agent has one selected LLM; no implicit calls to other globally authenticated models.
            createCodemodeExtension({ models: false }),
            createToolSearchExtension(),
            createMcpExtension({
              loadConfig: () => ({ servers, errors: [] }),
              createTransport: observeMcpTransport(createDefaultTransport, statuses),
              updateConfig: () => {
                throw new Error(
                  'Edit resource assignments in Pi Studio; OAuth sign-in is available in /mcp.',
                );
              },
            }),
          ],
        },
      });
      const errors = services.resourceLoader.getExtensions().errors;
      if (errors.length) throw new Error('A selected Pi extension could not load');
      const skills = services.resourceLoader.getSkills();
      if (
        skills.diagnostics.some((item) => item.type === 'error') ||
        envelope.resources.skills.some(
          (item) => !skills.skills.some((loaded) => loaded.name === item.name),
        )
      )
        throw new Error('A selected skill could not load');
      const model = services.modelRuntime.getModel(
        envelope.record.model.provider,
        envelope.record.model.id,
      );
      if (!model) throw new Error('The explicitly selected model is unavailable');
      if (initialImages.length && !model.input?.includes('image'))
        throw new Error('Selected model does not support image input');
      const levels = {
        Минимальный: 'minimal',
        Низкий: 'low',
        Средний: 'medium',
        Высокий: 'high',
        Максимальный: 'xhigh',
      };
      const result = await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
        model,
        thinkingLevel: levels[envelope.record.model.reasoning] ?? 'medium',
      });
      if (
        result.session.model?.id !== model.id ||
        result.session.model?.provider !== model.provider
      )
        throw new Error('Pi substituted the requested model');
      return { ...result, services, diagnostics: services.diagnostics };
    };
    runtime = await createAgentSessionRuntime(factory, {
      cwd: envelope.record.cwd,
      agentDir: getAgentDir(),
      sessionManager: sessions,
    });
    heartbeat = setInterval(() => {
      void event({ type: 'heartbeat' }).then(
        () => {
          failures = 0;
        },
        () => {
          if (++failures >= 2) shutdown();
        },
      );
    }, 3000);
    bindingTimer = setInterval(() => {
      void bindWrittenSession().catch(() => {});
    }, 100);
    if (bootstrap.headless) {
      await runtime.session.bindExtensions({});
      await waitForMcp(statuses, requiredServers);
      await event({ type: 'opened' });
      await bindWrittenSession();
      if (initialMessage) await runtime.session.prompt(initialMessage, { images: initialImages });
    } else {
      const mode = new InteractiveMode(runtime, {
        initialMessage,
        initialImages,
        verbose: false,
      });
      await mode.init();
      await waitForMcp(statuses, requiredServers);
      await event({ type: 'opened' });
      await bindWrittenSession();
      await mode.run();
    }
    await bindWrittenSession();
  } catch {
    await event({ type: 'error' }).catch(() => {});
    process.stderr.write(
      'Pi Studio: не удалось продолжить работу. Проверьте выбранную модель, авторизацию и назначенные ресурсы.\n',
    );
    process.exitCode = 1;
  } finally {
    await close();
    process.removeListener('SIGTERM', shutdown);
    process.removeListener('SIGHUP', shutdown);
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  await runSession(process.argv[2]);
