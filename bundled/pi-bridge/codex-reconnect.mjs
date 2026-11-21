import { classifyProviderFailure } from './provider-failure.mjs';

const connectionFailure =
  /\b(?:UND_ERR_(?:CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT|SOCKET)|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|EAI_AGAIN)\b|\b(?:connect timeout|connection reset|socket hang up)\b/i;

export function registerCodexReconnect(pi, settings, language) {
  const { maxRetries, maxAgentDelayMs } = settings.getRetrySettings();
  const normal = { maxRetries, maxAgentDelayMs };
  const reconnect = { maxRetries: 24, maxAgentDelayMs: 30_000 };
  let active = false;
  const update = (waiting, ctx) => {
    if (waiting === active) return;
    active = waiting;
    settings.applyOverrides({ retry: waiting ? reconnect : normal });
    ctx.ui.setStatus(
      'pistudio-codex-reconnect',
      !waiting
        ? undefined
        : language() === 'ru'
          ? 'Восстанавливаем связь с Codex…'
          : 'Reconnecting to Codex…',
    );
  };
  // Pi calls this hook before it selects its native retry policy. Only the failed
  // model response is retried, using the existing conversation and tool results.
  pi.on('agent_end', ({ messages }, ctx) => {
    const last = messages.findLast((message) => message.role === 'assistant');
    update(
      settings.getRetryEnabled() &&
        last?.provider === 'openai-codex' &&
        last.stopReason === 'error' &&
        classifyProviderFailure(last.errorMessage) === 'network' &&
        connectionFailure.test(last.errorMessage),
      ctx,
    );
  });
  pi.on('message_end', ({ message }, ctx) => {
    if (message.role === 'assistant' && message.stopReason !== 'error') update(false, ctx);
  });
  pi.on('agent_settled', (_event, ctx) => update(false, ctx));
}
