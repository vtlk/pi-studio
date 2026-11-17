import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { useConnections } from '@/features/connections/model/Connections';
import { useResources } from '@/features/resources/model/Resources';
import { useTeamTransfers } from '@/features/agents/model/TeamTransfers';
import { useStorage } from '@/shared/storage/Storage';
import { useNavigation } from '@/shared/model/Navigation';
import { OnboardingContext } from './Onboarding.context';
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
  const { page, navigate } = useNavigation();
  const key = `pistudio:onboarding:v1:${bootstrap?.folder ?? 'preview'}`;
  const candidates = useMemo(
    () => onboardingTasks([...agents, ...systemAgents], teams, connections, resources, reports),
    [agents, systemAgents, teams, connections, resources, reports],
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
    return loaded
      ? current
      : [...current, ...history.filter((record) => record.id.startsWith('mcp:'))];
  }, [history, candidates, now, loaded]);
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
    if (page === 'onboarding' && !visible) navigate('projects');
  }, [page, visible, navigate]);
  return (
    <OnboardingContext.Provider value={{ tasks, visible }}>{children}</OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const value = useContext(OnboardingContext);
  if (!value) throw new Error('OnboardingProvider is missing');
  return value;
}
