import { pathToFileURL } from 'node:url';
try {
  const { ModelRuntime } = await import(pathToFileURL(process.argv[2]).href);
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
  process.stdout.write(JSON.stringify({ providers, models }));
} catch {
  process.stderr.write('Pi model catalog is unavailable.\n');
  process.exitCode = 1;
}
