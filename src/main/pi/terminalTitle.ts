import type { PreparedRun } from './ContextBuilder.ts';

export const runTerminalTitle = (run: PreparedRun) =>
  agentTerminalTitle(run.agent.profile.name, run.project.name);

/** Names stay data in AppleScript/OSC; control characters must never form terminal sequences. */
export function agentTerminalTitle(
  agentName: string | undefined,
  projectName: string | undefined,
): string {
  const label = (name: string | undefined) =>
    (typeof name === 'string' ? name : '')
      .replace(/\p{Cc}/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim() || 'Без названия';
  return `${label(agentName)} · ${label(projectName)}`;
}
