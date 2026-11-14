import { loadThinkingApi } from './thinking.mjs';
export async function catalogData(sdk, runtime, cwd, scope, sdkPath) {
  const thinking = await loadThinkingApi(sdkPath);
  const builtins = await sdk.ModelRuntime.create({
    credentials: {
      read: async () => undefined,
      list: async () => [],
      modify: async () => {
        throw new Error('Read-only catalog');
      },
      delete: async () => {
        throw new Error('Read-only catalog');
      },
    },
    modelsPath: null,
    refreshOnCreate: false,
  });
  const providers = runtime.getProviders().map((provider) => {
    // Isolation disables other accounts at runtime, but their login forms still belong
    // in the catalog. Never advertise the isolation guard as a provider's auth method.
    const auth =
      scope && provider.id !== scope.provider
        ? (builtins.getProvider(provider.id)?.auth ?? provider.auth)
        : provider.auth;
    return {
      id: provider.id,
      name: provider.name || provider.id,
      configured: runtime.hasConfiguredAuth(provider.id),
      subscription: runtime.isUsingSubscription(provider.id),
      isolatedAuth: !!builtins.getProvider(provider.id) || scope?.provider === provider.id,
      loginMethods: [
        ...(auth.oauth ? [{ id: 'oauth', label: auth.oauth.loginLabel || auth.oauth.name }] : []),
        ...(auth.apiKey?.login ? [{ id: 'api_key', label: auth.apiKey.name }] : []),
      ],
    };
  });
  const models = runtime.getModels().map((model) => ({
    provider: model.provider,
    id: model.id,
    name: model.name || model.id,
    reasoning: model.reasoning === true,
    reasoningLevels: thinking.getSupportedThinkingLevels(model),
    defaultReasoningLevel: thinking.clampThinkingLevel(model, 'medium'),
    imageInput: model.input?.includes('image') === true,
    api: model.api,
  }));
  const settings = sdk.SettingsManager.create(cwd || process.cwd());
  const provider = settings.getDefaultProvider(),
    id = settings.getDefaultModel();
  return { providers, models, ...(provider && id ? { nativeDefault: { provider, id } } : {}) };
}
