// Native compatibility adapter and native credential store; no global provider configuration.
export function registerEndpoint(runtime, scope) {
  const { url, config } = scope.endpoint;
  if (runtime.getProvider(scope.provider)) throw new Error('Custom provider ID collides with Pi');
  runtime.registerProvider(scope.provider, {
    name: 'Studio endpoint',
    baseUrl: url,
    api: config.api,
    models: config.models.map((model) => ({
      id: model.id,
      name: model.name,
      api: config.api,
      input: model.imageInput ? ['text', 'image'] : ['text'],
      reasoning: model.reasoning,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    })),
  });
  if (config.auth === 'none') {
    const provider = runtime.getProvider(scope.provider);
    runtime.registerNativeProvider({
      ...provider,
      auth: {
        apiKey: {
          name: 'No authentication',
          check: async () => ({ type: 'api_key', source: 'Explicit keyless endpoint' }),
          // OpenAI's adapter requires a client key; null removes its Authorization default header.
          resolve: async () => ({
            auth: { apiKey: 'pistudio-keyless', headers: { Authorization: null } },
          }),
        },
      },
    });
  }
}

export async function discoverEndpointModels(runtime, scope) {
  if (!scope?.endpoint) throw new Error('Not a custom endpoint');
  const auth = await runtime.getAuth(scope.provider);
  if (!auth) throw new Error('Configure selected endpoint authentication');
  const headers = new Headers();
  if (scope.endpoint.config.auth === 'api_key')
    headers.set('Authorization', `Bearer ${auth.auth.apiKey}`);
  const response = await fetch(`${scope.endpoint.url}/models`, {
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error('Endpoint model list unavailable');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1000000) throw new Error('Model list too large');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!Array.isArray(data.data) || data.data.length > 1000) throw new Error('Invalid model list');
  return [
    ...new Set(
      data.data.map((item) => {
        if (typeof item.id !== 'string' || !item.id.trim() || item.id.length > 500)
          throw new Error('Invalid model ID');
        return item.id.trim();
      }),
    ),
  ];
}
