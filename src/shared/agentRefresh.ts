export interface AgentRefreshRun {
  agentId: string;
  agentName: string;
  runId: string;
  sequence: number;
  working: boolean;
}
export interface AgentRefreshConsent {
  revision: string;
  running: { runId: string; sequence: number }[];
}
export interface AgentRefreshReview {
  projectId: string;
  revision: string;
  changed: { id: string; name: string }[];
  restarting: AgentRefreshRun[];
  removing: AgentRefreshRun[];
}
