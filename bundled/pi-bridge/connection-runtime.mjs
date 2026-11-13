// Public native Pi APIs only. Isolated model auth never consults ambient accounts/config files.
export async function createConnectionRuntime(sdk, scope) {
  if (!scope) return sdk.ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: true });
  if (
    typeof scope.authPath !== 'string' ||
    !scope.authPath.startsWith('/') ||
    typeof scope.provider !== 'string'
  )
    throw new Error('Invalid connection auth scope');
  const runtime = await sdk.ModelRuntime.create({
    authPath: scope.authPath,
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
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
