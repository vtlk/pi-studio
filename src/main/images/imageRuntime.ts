import type { PiModelSummary } from '../../shared/models.ts';

// Pi 1.5.2 KnownApi: AgentSession uses streamSimple(), whose AssistantMessage
// contains text/thinking/tool calls. ImageModel/generateImages is a separate API.
// This is about this pinned chat adapter, not a provider's other image products.
// An executable extension can change that contract and is checked separately.
const chatApis = new Set([
  'openai-completions',
  'mistral-conversations',
  'openai-responses',
  'azure-openai-responses',
  'openai-codex-responses',
  'anthropic-messages',
  'bedrock-converse-stream',
  'google-generative-ai',
  'google-vertex',
  'pi-messages',
]);

export function confirmedChatAdapter(model: PiModelSummary) {
  return typeof model.api === 'string' && chatApis.has(model.api);
}
