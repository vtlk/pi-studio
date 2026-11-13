import { pathToFileURL } from 'node:url';
try {
  const { ModelRuntime, SettingsManager } = await import(pathToFileURL(process.argv[2]).href);
  const runtime = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: true });
  const providers = runtime.getProviders().map((provider) => ({
    id: provider.id,
    name: provider.name || provider.id,
    configured: runtime.hasConfiguredAuth(provider.id),
    subscription: runtime.isUsingSubscription(provider.id),
  }));
  const models = runtime.getModels().map((model) => ({
    provider: model.provider,
    id: model.id,
    name: model.name || model.id,
    reasoning: model.reasoning === true,
    imageInput: model.input?.includes('image') === true,
  }));
  const settings = SettingsManager.create(process.argv[3] || process.cwd());
  const provider = settings.getDefaultProvider(),
    id = settings.getDefaultModel();
  process.stdout.write(
    JSON.stringify({
      providers,
      models,
      ...(provider && id ? { nativeDefault: { provider, id } } : {}),
    }),
  );
} catch {
  process.stderr.write('Pi model catalog is unavailable.\n');
  process.exitCode = 1;
}
