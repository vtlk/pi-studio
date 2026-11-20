import type { ChatReset, ChatState } from '../../shared/chat.ts';
import { t } from '../../shared/i18n/index.ts';
import type { PreparedRun } from './ContextBuilder.ts';
import type { LaunchAgentResult } from '../../shared/runtime.ts';
import { runKey } from './RunTypes.ts';

interface ResetState {
  assertAvailable: () => void;
  busy: () => boolean;
  chat: () => ChatState | null;
  run: () => PreparedRun | undefined;
  refreshing: Set<string>;
  stop: () => Promise<void>;
  clear: (run: PreparedRun) => Promise<void>;
  forget: () => void;
  open: () => Promise<LaunchAgentResult>;
  changed: () => void;
}

/** A new native session, not an in-place history rewrite. Never sends a task. */
export async function resetChat(request: ChatReset, state: ResetState) {
  state.assertAvailable();
  const chat = state.chat(),
    run = state.run();
  if (!run || !chat || chat.runId !== request.runId || run.record.runId !== request.runId)
    throw Error(t('Chat.resetChanged'));
  if (
    state.busy() ||
    chat.phase === 'opening' ||
    chat.working ||
    chat.dialog ||
    chat.queue?.steering.length ||
    chat.queue?.followUp.length
  )
    throw Error(t('Chat.resetBusy'));
  const key = runKey(request);
  state.refreshing.add(key); // Blocks new manual/chain/Team admission for this agent only.
  state.changed();
  try {
    await state.stop(); // Wait for actual owned child exit and final persistence outside the store queue.
    await state.clear(run);
    state.forget();
    return await state.open(); // Normal prepare rebuilds context/resources; no firstMessage/chain.
  } finally {
    state.refreshing.delete(key);
    state.changed();
  }
}
