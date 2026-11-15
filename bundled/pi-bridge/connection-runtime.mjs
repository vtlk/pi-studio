import { registerEndpoint } from './endpoint-runtime.mjs';
import { isAbsolute } from 'node:path';
import { nativeExtensionPaths } from './native-extensions.mjs';
import { withClaudeExtension } from './claude-code/extensions.mjs';

const providerAuth = new WeakMap();
export const nativeProviderAuth = (runtime, id) => providerAuth.get(runtime)?.get(id);

export async function createConnectionServices(sdk, scope, cwd = process.cwd(), options = {}) {
  const runtime = await createBaseRuntime(sdk, scope);
  const nativePaths = options.nativePaths ?? (await nativeExtensionPaths(sdk, cwd));
  const { additionalExtensionPaths = [], ...loaderOptions } = options.resourceLoaderOptions ?? {};
  const services = await sdk.createAgentSessionServices({
    cwd,
    modelRuntime: runtime,
    settingsManager:
      options.settingsManager ??
      sdk.SettingsManager.inMemory({ packages: [], extensions: [], skills: [], prompts: [] }),
    resourceLoaderOptions: {
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: '',
      appendSystemPrompt: [],
      ...loaderOptions,
      additionalExtensionPaths: await withClaudeExtension([
        ...nativePaths,
        ...additionalExtensionPaths,
      ]),
    },
  });
  if (
    services.resourceLoader.getExtensions().errors.length ||
    services.diagnostics.some((item) => item.type === 'error')
  )
    throw Error('A native or selected Pi extension could not load');
  providerAuth.set(
    runtime,
    new Map(runtime.getProviders().map((provider) => [provider.id, provider.auth])),
  );
  await isolateConnection(runtime, scope);
  // Native registration also schedules asynchronous refreshes. Finish a scoped
  // pass before reading its dynamic CLI catalog for preflight/session creation.
  if (!scope || scope.provider === 'claude-code')
    await runtime.refresh({ allowNetwork: false, providers: ['claude-code'] });
  return services;
}

// Catalog/auth and the actual session use the same native provider-registration lifecycle.
export async function createConnectionRuntime(sdk, scope, cwd) {
  return (await createConnectionServices(sdk, scope, cwd)).modelRuntime;
}

async function createBaseRuntime(sdk, scope) {
  if (!scope) return sdk.ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: true });
  if (
    typeof scope.authPath !== 'string' ||
    !isAbsolute(scope.authPath) ||
    typeof scope.provider !== 'string'
  )
    throw new Error('Invalid connection auth scope');
  const runtime = await sdk.ModelRuntime.create({
    authPath: scope.authPath,
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  if (scope.endpoint) registerEndpoint(runtime, scope);
  return runtime;
}

async function isolateConnection(runtime, scope) {
  if (!scope) return;
  if (!runtime.getProvider(scope.provider))
    throw new Error('Provider needs native Pi configuration');
  // Keep the pinned provider's login, OAuth refresh and request adapter. Disable implicit env/file auth.
  const ctx = { env: async () => undefined, fileExists: async () => false };
  for (const provider of runtime.getProviders()) {
    if (provider.id !== scope.provider) {
      runtime.registerNativeProvider({
        ...provider,
        auth: {
          apiKey: {
            name: 'Unavailable outside selected connection',
            login: async () => {
              throw new Error('Select another connection in Studio');
            },
            check: async () => undefined,
            resolve: async () => undefined,
          },
        },
      });
      continue;
    }
    const api = provider.auth.apiKey;
    if (!api) continue;
    if (scope.endpoint?.config.auth === 'none') continue;
    runtime.registerNativeProvider({
      ...provider,
      auth: {
        ...provider.auth,
        apiKey: {
          ...api,
          check: async (input) => {
            if (!input.credential) return undefined;
            const scoped = { ...input, ctx };
            return api.check
              ? api.check(scoped)
              : (await api.resolve(scoped))
                ? { type: 'api_key', source: 'stored credential' }
                : undefined;
          },
          resolve: (input) =>
            input.credential ? api.resolve({ ...input, ctx }) : Promise.resolve(undefined),
        },
      },
    });
  }
  await runtime.refresh({ allowNetwork: false, providers: [scope.provider] });
  return runtime;
}
