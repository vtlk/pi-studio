/** Live request state only; no transcripts, settings or filesystem data. */
export interface ProjectActivity {
  projectId: string;
  runningAgents: number;
}
