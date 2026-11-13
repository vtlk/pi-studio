import type { WorkspaceProject } from './project';

export interface LaunchAgentRequest {
  projectId: string;
  agentId: string;
  firstMessage?: string;
  autoContinue: boolean;
}
export interface LaunchAgentResult {
  runId: string;
  project: WorkspaceProject;
}
export interface RunContextRecord {
  schemaVersion: 1;
  runId: string;
  projectId: string;
  agentId: string;
  createdAt: number;
  cwd: string;
  output: string;
  sessionDirectory: string;
  previousOutputs: { agentId: string; path: string }[];
  model: { connectionId: string; provider: string; id: string; reasoning: string };
  resourceIds: { skills: string[]; mcps: string[]; plugins: string[] };
  instructionIds: string[];
}
