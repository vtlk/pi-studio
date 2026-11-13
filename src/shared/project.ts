import type { Agent } from './studio';

export type OutputEntry = OutputFolder | OutputFile;
export interface OutputFolder {
  kind: 'folder';
  id: string;
  name: string;
  createdAt?: number;
  children: OutputEntry[];
}
export interface OutputFile {
  kind: 'file';
  id: string;
  name: string;
  createdAt?: number;
  format: 'text' | 'markdown' | 'json' | 'image' | 'audio' | 'video' | 'unsupported';
  content?: string;
  src?: string;
  /** Relative to the project root, resolved only by main. */
  diskPath?: string;
  modifiedAt?: number;
  size?: number;
  fingerprint?: string;
  previewError?: string;
  artifact?: ArtifactDescription;
  montageScope?: 'scene' | 'film';
}
export type ProjectAgentProfile = Omit<Agent, 'instructions' | 'mainInstruction'>;
export interface ProjectAgent {
  profile: ProjectAgentProfile;
  outputPath: string;
  session?: SessionBinding;
  runStatus?: AgentRunStatus;
  entries: OutputEntry[];
}
export type AgentRunStatus = 'idle' | 'running' | 'waiting' | 'ready' | 'error' | 'stopped';
export interface WorkspaceProject {
  id: string;
  name: string;
  createdAt: number;
  folderName?: string;
  autoContinue?: boolean;
  reviews?: Record<string, { revision: number; acceptedRevision: number | null }>;
  agents: ProjectAgent[];
  archivedAgents?: { agent: ProjectAgent; position: number }[];
}

export interface ArtifactDescription {
  kind: 'script' | 'plan' | 'cast' | 'scene' | 'voice' | 'sound' | 'review';
  title: string;
  fields: [string, string][];
  actions: string[];
  reference?: { id: string; version: number; latestVersion: number; title: string };
}

export interface SessionBinding {
  id: string;
  title: string;
  path: string;
  createdAt: number;
  /** Launch input; Pi remains the owner of the conversation transcript. */
  initialMessage?: string;
  needsFork?: boolean;
  missing?: boolean;
}
