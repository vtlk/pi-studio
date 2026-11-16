import { t, type MessageKey } from '../../../shared/i18n/index.ts';
import type { RunFailure, TerminalCloseDetail } from '../../../shared/runFailure.ts';
const runFailureLabels: Record<RunFailure, MessageKey> = {
  usage_limit: 'runFailureLabels.usage_limit',
  rate_limit: 'runFailureLabels.rate_limit',
  authentication: 'runFailureLabels.authentication',
  network: 'runFailureLabels.network',
  provider: 'runFailureLabels.provider',
  outputs: 'runFailureLabels.outputs',
  opening: 'runFailureLabels.opening',
  continuation: 'runFailureLabels.continuation',
  terminal_close: 'runFailureLabels.terminal_close',
};
export function failureLabel(code: RunFailure) {
  return t(runFailureLabels[code]);
}
const runFailureMessages: Record<RunFailure, MessageKey> = {
  usage_limit: 'runFailureMessages.usage_limit',
  rate_limit: 'runFailureMessages.rate_limit',
  authentication: 'runFailureMessages.authentication',
  network: 'runFailureMessages.network',
  provider: 'runFailureMessages.provider',
  outputs: 'runFailureMessages.outputs',
  opening: 'runFailureMessages.opening',
  terminal_close: 'runFailureMessages.terminal_close',
  continuation: 'runFailureMessages.continuation',
};
export function failureMessage(code: RunFailure) {
  return t(runFailureMessages[code]);
}
const terminalCloseMessages: Record<TerminalCloseDetail, MessageKey> = {
  automation_denied: 'terminalCloseMessages.automation_denied',
  terminal_busy: 'terminalCloseMessages.terminal_busy',
  shared_window: 'terminalCloseMessages.shared_window',
  identity_changed: 'terminalCloseMessages.identity_changed',
  terminal_unavailable: 'terminalCloseMessages.terminal_unavailable',
};
export function terminalMessage(code: TerminalCloseDetail) {
  return t(terminalCloseMessages[code]);
}
