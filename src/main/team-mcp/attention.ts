import { rm } from 'node:fs/promises';
import { atomicJson, isMissing, readJson, safePath } from '../storage/files.ts';
import type { PreparedRun } from '../pi/ContextBuilder.ts';
import type { ChannelEvent } from '../pi/RunChannel.ts';
import type { TeamHost } from './types.ts';

function path(agentId: string) {
  return `.pistudio/team/attention/${agentId}.json`;
}
export async function needsUser(root: string, agentId: string) {
  try {
    return !!(await readJson(await safePath(root, path(agentId))));
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}
/** Persist question/error gates across closing Pi and restarting Studio. Manual input alone clears them. */
export async function observeAttention(run: PreparedRun, event: ChannelEvent, host?: TeamHost) {
  if (!run.project.sourceTeamId) return;
  const file = await safePath(run.projectRoot, path(run.record.agentId), true);
  if (event.type === 'request' && !event.messageId) {
    await rm(file, { force: true });
    return;
  }
  if (!['settled', 'error', 'stopped'].includes(event.type)) return;
  const state = host?.inspect(run.project.id, run.record.agentId);
  if (state && ['waiting', 'error', 'stopped'].includes(state.status))
    await atomicJson(file, {
      projectId: run.project.id,
      agentId: run.record.agentId,
      runId: run.record.runId,
      status: state.status,
      updatedAt: Date.now(),
    });
}
