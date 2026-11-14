import type { ThinkingLevel } from './reasoning';
import type { WorkspaceProject } from './project';
import type { SavedAttachment } from './attachments';

export interface LaunchAgentRequest {
  projectId: string;
  agentId: string;
  firstMessage?: string;
  autoContinue: boolean;
  attachments?: string[];
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
  projectRoot: string;
  cwd: string;
  output: string;
  sessionDirectory: string;
  previousOutputs: { agentId: string; agentName?: string; path: string }[];
  model: {
    connectionId: string;
    provider: string;
    id: string;
    reasoning: string;
    thinkingLevel: ThinkingLevel;
  };
  resourceIds: { skills: string[]; mcps: string[]; plugins: string[] };
  instructionIds: string[];
  attachments?: SavedAttachment[];
}
