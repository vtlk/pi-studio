import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { useConnections } from '@/features/connections/model/Connections';
import { useResources } from '@/features/resources/model/Resources';
import { useTeamTransfers } from '@/features/agents/model/TeamTransfers';
import { useStorage } from '@/shared/storage/Storage';
import { useNavigation } from '@/shared/model/Navigation';
import { OnboardingContext } from './Onboarding.context';
import { useReadiness } from './useReadiness';
import { useWorkspace } from '@/features/project/model/Workspace';
import {
  onboardingTasks,
  reconcileOnboarding,
  parseOnboardingRecords,
} from '../../../shared/onboarding';

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { agents, systemAgents, teams } = useAgentProfiles();
  const { connections } = useConnections();
  const { resources } = useResources();
  const { reports, loaded } = useTeamTransfers();
  const { bootstrap } = useStorage();
  const { projects } = useWorkspace();
  const readiness = useReadiness(
    bootstrap?.folder,
    JSON.stringify([
      connections,
      teams.map((team) => team.id),
      resources.map((resource) => [
        resource.id,
        resource.source,
        resource.credential,
        resource.mcpSecretNames,
      ]),
    ]),
  );
  const { page, navigate } = useNavigation();
  const key = `pistudio:onboarding:v1:${bootstrap?.folder ?? 'preview'}`;
  const candidates = useMemo(
    () =>
      onboardingTasks([...agents, ...systemAgents], teams, connections, resources, reports, {
        projectCount: projects.length,
        readinessError: readiness.error,
        readiness:
          readiness.state ??
          (window.studio
            ? { folder: bootstrap?.folder ?? '', terminal: 'ready', connections: {}, mcps: {} }
            : undefined),
      }),
    [
      agents,
      systemAgents,
      teams,
      connections,
      resources,
      reports,
      projects.length,
      readiness.state,
      readiness.error,
      bootstrap?.folder,
    ],
  );
  const [history, setHistory] = useState(() => {
    try {
      return parseOnboardingRecords(JSON.parse(localStorage.getItem(key) ?? '[]'));
    } catch {
      return [];
    }
  });
  const [now, setNow] = useState(Date.now);
  const records = useMemo(() => {
    const current = reconcileOnboarding(history, candidates, now);
    return [
      ...current,
      ...history.filter(
        (record) =>
          !current.some((item) => item.id === record.id) &&
          ((!loaded && record.id.startsWith('mcp:')) ||
            (!readiness.state &&
              (record.id === 'images' ||
                record.id === 'git' ||
                record.id === 'terminal' ||
                record.id.startsWith('connection:')))),
      ),
    ];
  }, [history, candidates, now, loaded, readiness.state]);
  const tasks = candidates.filter((task) => records.some((record) => record.id === task.id));
  const visible = tasks.some((task) => !task.complete);
  const serialized = JSON.stringify(records);
  useEffect(() => {
    const next = parseOnboardingRecords(JSON.parse(serialized));
    setHistory((previous) => (JSON.stringify(previous) === serialized ? previous : next));
    try {
      localStorage.setItem(key, serialized);
    } catch {
      /* UI history may remain in memory. */
    }
  }, [serialized, key]);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 30000);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', tick);
    };
  }, []);
  useEffect(() => {
    if (page !== 'onboarding' || visible) return;
    // Finishing auth must not unmount an editor with a draft or dismiss an active consent flow.
    const leave = () => {
      if (!document.querySelector('[aria-modal="true"]')) navigate('projects');
    };
    leave();
    const observer = new MutationObserver(leave);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [page, visible, navigate]);
  return (
    <OnboardingContext.Provider value={{ tasks, visible, readiness: readiness.state }}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const value = useContext(OnboardingContext);
  if (!value) throw new Error('OnboardingProvider is missing');
  return value;
}
