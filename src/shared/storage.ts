import type { Agent } from './studio';
import type { WorkspaceProject } from './project';

export const storageSections = [
  'agents',
  'systemAgents',
  'libraryAgents',
  'resources',
  'connections',
  'imageTool',
  'hiddenLibraryIds',
  'baseInstruction',
  'piPath',
] as const;
export type StorageSection = (typeof storageSections)[number];
export type StudioSections = Partial<Record<StorageSection, unknown>>;
export interface SectionEdit {
  folder: string;
  base: unknown;
}
export interface SectionSaveResult {
  saved: boolean;
  value: unknown;
}
export interface StudioBootstrap {
  folder: string;
  sections: StudioSections;
  projects: WorkspaceProject[];
  trashProjects: WorkspaceProject[];
  warnings: string[];
}
export type ProjectCommand =
  | { kind: 'create'; name: string; agents: Agent[] }
  | { kind: 'update-agents'; projectId: string; agents: Agent[]; updateExisting: boolean }
  | { kind: 'rename'; projectId: string; name: string }
  | { kind: 'clone'; projectId: string; name: string }
  | { kind: 'remove-agent' | 'restore-agent'; projectId: string; agentId: string }
  | { kind: 'remove' | 'restore'; projectId: string };
export interface ProjectCommandResult {
  projects: WorkspaceProject[];
  trashProjects: WorkspaceProject[];
  selectedId?: string;
}
export interface FileRequest {
  projectId: string;
  path: string;
}
export type AgentDataTarget = 'dialogue' | 'files' | 'all';
export interface DeleteAgentDataRequest {
  target: AgentDataTarget;
  folder: string;
  projectId: string;
  agentId: string;
}
