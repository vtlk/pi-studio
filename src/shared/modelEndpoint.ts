import { t } from './i18n/index.ts';
export interface EndpointModel {
  id: string;
  name: string;
  imageInput: boolean;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
}
export interface ModelEndpoint {
  api: 'openai-completions' | 'openai-responses';
  auth: 'api_key' | 'none';
  models: EndpointModel[];
}
export function modelEndpointUrl(value: string) {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(t('error.modelEndpoint.anHttpHttpsApiAddress'));
  return url.href.replace(/\/+$/, '');
}
export function endpointProviderId(id: string) {
  return `studio-${id}`;
}
export function parseModelEndpoint(value: unknown): ModelEndpoint {
  if (!value || typeof value !== 'object')
    throw new Error(t('error.modelEndpoint.configureTheModelServerProtocol'));
  const data = value as ModelEndpoint;
  if (
    !['openai-completions', 'openai-responses'].includes(data.api) ||
    !['api_key', 'none'].includes(data.auth) ||
    !Array.isArray(data.models) ||
    data.models.length > 1000
  )
    throw new Error(t('error.modelEndpoint.invalidModelServerSettings'));
  const ids = new Set<string>();
  const models = data.models.map((model) => {
    if (
      !model ||
      typeof model.id !== 'string' ||
      !model.id.trim() ||
      model.id.length > 500 ||
      typeof model.name !== 'string' ||
      model.name.length > 500 ||
      typeof model.imageInput !== 'boolean' ||
      typeof model.reasoning !== 'boolean' ||
      !Number.isSafeInteger(model.contextWindow) ||
      model.contextWindow < 1 ||
      model.contextWindow > 10000000 ||
      !Number.isSafeInteger(model.maxTokens) ||
      model.maxTokens < 1 ||
      model.maxTokens > model.contextWindow ||
      ids.has(model.id.trim())
    )
      throw new Error(t('error.modelEndpoint.checkModelIdsCapabilitiesAnd'));
    ids.add(model.id.trim());
    return {
      id: model.id.trim(),
      name: model.name.trim() || model.id.trim(),
      imageInput: model.imageInput,
      reasoning: model.reasoning,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    };
  });
  return { api: data.api, auth: data.auth, models };
}
