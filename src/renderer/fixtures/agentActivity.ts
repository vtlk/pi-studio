import type { AgentRunStatus, ProjectAgent } from '@/features/project/model/workspace.types';

const statuses: Record<string, AgentRunStatus> = {
  writer: 'ready',
  characters: 'waiting',
  scenes: 'running',
  animation: 'error',
  editor: 'stopped',
  reviewer: 'idle',
};

/** Static UI examples; no Pi process or transcript exists. */
export function demoAgentActivity(agentId: string): Pick<ProjectAgent, 'runStatus' | 'session'> {
  const runStatus = statuses[agentId] ?? 'idle';
  if (runStatus === 'idle') return { runStatus };
  const id = `demo-session-${agentId}`;
  return {
    runStatus,
    session: {
      id,
      title: 'Основной диалог',
      path: `agents/${agentId}/sessions/${id}.jsonl`,
      createdAt: 1,
    },
  };
}
