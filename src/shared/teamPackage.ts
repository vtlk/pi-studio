import type { Agent } from './studio';

export interface PortableResource {
  id: string;
  name: string;
  kind: 'skills' | 'mcps' | 'plugins';
  description: string;
  version: string;
  source: string;
  filesRoot?: string;
  mcp?: Record<string, unknown>;
  authorization?: import('./mcpAuthorization').McpAuthorization;
  requirements: string[];
}
export interface PortableConnection {
  id: string;
  name: string;
  provider: string;
  purpose: string;
  endpoint?: string;
  endpointConfig?: import('./modelEndpoint').ModelEndpoint;
}
export interface TeamPackageManifest {
  format: 'pi-studio-team';
  version: 1;
  team: { name: string; workspaceMode?: import('./agentTeams').TeamWorkspaceMode };
  agents: Agent[];
  resources: PortableResource[];
  connections: PortableConnection[];
  requirements: string[];
  tools?: { images: boolean };
}
export interface TeamPackageFile {
  path: string;
  sha256: string;
  data: string;
  executable: boolean;
}
export interface TeamPackage {
  manifest: TeamPackageManifest;
  files: TeamPackageFile[];
}
export interface TeamImportReport {
  id: string;
  teamId: string;
  teamName: string;
  createdAt: number;
  handoff: 'pending' | 'sending' | 'sent' | 'uncertain';
  /** Separate one-use MCP task, including imports previously handed to the legacy assistant. */
  mcpHandoff?: 'pending' | 'sending' | 'sent' | 'uncertain';
  mcpReady?: boolean;
  agents: { agentId: string; name: string; issues: string[] }[];
  requirements: string[];
  mcps?: {
    resourceId: string;
    name?: string;
    authorization: import('./mcpAuthorization').McpAuthorization;
  }[];
  requiresImages?: boolean;
}
export interface TeamPackageRequest {
  folder: string;
  teamId: string;
}
export interface TeamSetupResult {
  report: TeamImportReport;
  assistantId: string;
  outcome: 'opened' | 'busy' | 'needs_configuration' | 'pending' | 'uncertain';
  message?: string;
}
