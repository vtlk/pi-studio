import type { AgentRefreshConsent, AgentRefreshReview } from '../../shared/agentRefresh.ts';
import type { Agent } from '../../shared/studio.ts';
import type { Resource } from '../../shared/resources.ts';
import type { ProjectCommand } from '../../shared/storage.ts';
import type { StudioService, StudioStore } from './StudioStore.ts';
import type { RunHost } from '../pi/RunHost.ts';
import { snapshotAgent, stableId } from './validation.ts';
import { agentRefreshSignature, refreshDigest } from '../pi/agentRefreshSignature.ts';
import { t } from '../../shared/i18n/index.ts';

type Update = Extract<ProjectCommand, { kind: 'update-agents' }>;
export class AgentRefresh {
  private readonly service: StudioService;
  private readonly runs: RunHost;
  constructor(service: StudioService, runs: RunHost) {
    this.service = service;
    this.runs = runs;
  }
  private inputs(projectId: string, updateExisting: boolean) {
    stableId(projectId);
    if (typeof updateExisting !== 'boolean') throw new Error(t('AgentRefresh.invalidRequest'));
    return this.service.serialize(async () =>
      this.readInputs(await this.service.load(), projectId, updateExisting),
    );
  }
  private async readInputs(store: StudioStore, projectId: string, updateExisting: boolean) {
    const project = await store.projects.read(projectId);
    if (
      !project.sourceTeamId ||
      !store.agentCatalog().teams.some((team) => team.id === project.sourceTeamId)
    )
      throw new Error(t('error.registerProjectCommands.selectAnAgentTeamFor'));
    const agents = store.teamProfiles(project.sourceTeamId),
      sections = store.bootstrap().sections;
    const signatures = agents.map((agent) => [
      agent.id,
      agentRefreshSignature(snapshotAgent(agent).profile, agent, sections.resources as Resource[]),
    ]);
    const revision = refreshDigest({
      folder: store.folder,
      root: await store.projects.directory(projectId),
      teamId: project.sourceTeamId,
      profiles: project.agents.map((agent) => ({
        profile: agent.profile,
        outputPath: agent.outputPath,
        runtimePath: agent.runtimePath,
      })),
      signatures,
      updateExisting,
    });
    return {
      store,
      project,
      agents,
      revision,
      signatures: new Map(signatures as [string, string][]),
    };
  }
  async prepare(projectId: string, updateExisting: boolean): Promise<AgentRefreshReview> {
    const input = await this.inputs(projectId, updateExisting);
    const changed = input.agents
      .filter((current) => {
        const saved = input.project.agents.find((agent) => agent.profile.id === current.id);
        if (!saved) return false;
        const runtime = this.runs.inspect(projectId, current.id)?.run.refreshSignature;
        return (
          refreshDigest(saved.profile) !== refreshDigest(snapshotAgent(current).profile) ||
          (!!runtime && runtime !== input.signatures.get(current.id))
        );
      })
      .map((agent) => ({ id: agent.id, name: agent.name }));
    const removed = input.project.agents
      .filter((agent) => !input.agents.some((current) => current.id === agent.profile.id))
      .map((agent) => agent.profile.id);
    const restarting = this.runs.refreshSnapshot(
      projectId,
      updateExisting ? changed.map((agent) => agent.id) : [],
    );
    const removing = this.runs.refreshSnapshot(projectId, removed);
    return { projectId, revision: input.revision, changed, restarting, removing };
  }
  async apply(command: Update) {
    const review = await this.prepare(command.projectId, command.updateExisting);
    const consent: AgentRefreshConsent = command.refresh ?? {
      revision: review.revision,
      running: [],
    };
    if (
      !consent ||
      consent.revision !== review.revision ||
      !Array.isArray(consent.running) ||
      consent.running.length > 1000 ||
      consent.running.some(
        (item) =>
          !item ||
          typeof item.runId !== 'string' ||
          !Number.isSafeInteger(item.sequence) ||
          item.sequence < 0,
      )
    )
      throw new Error(t('AgentRefresh.reviewChanged'));
    const initial = await this.inputs(command.projectId, command.updateExisting);
    if (
      initial.revision !== review.revision ||
      refreshDigest(command.agents.map((agent: Agent) => snapshotAgent(agent).profile)) !==
        refreshDigest(initial.agents.map((agent) => snapshotAgent(agent).profile))
    )
      throw new Error(t('AgentRefresh.reviewChanged'));
    const removed = initial.project.agents
      .filter((agent) => !initial.agents.some((current) => current.id === agent.profile.id))
      .map((agent) => agent.profile.id);
    const affected = [
      ...(command.updateExisting ? review.changed.map((agent) => agent.id) : []),
      ...removed,
    ];
    return this.runs.refreshAgents(
      command.projectId,
      affected,
      review.restarting,
      review.removing,
      consent,
      async () => {
        return this.service.serialize(async () => {
          const store = await this.service.load();
          const current = await this.readInputs(store, command.projectId, command.updateExisting);
          if (current.revision !== review.revision)
            throw new Error(t('AgentRefresh.reviewChanged'));
          return store.command({ ...command, agents: current.agents });
        });
      },
    );
  }
}
