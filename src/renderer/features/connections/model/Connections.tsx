import { useStorage, useStoredState } from '@/shared/storage/Storage';
import { useContext, type ReactNode } from 'react';
import { ConnectionsContext } from './Connections.context';
import { useProviderStatuses } from './useProviderStatuses';
import type { Connection } from '../../../../shared/connections';
import { useImageConnections } from './useImageConnections';
export type { Connection } from '../../../../shared/connections';
export const exampleConnections: Connection[] = [
  {
    id: 'codex-subscription',
    name: 'Codex — подписка',
    purpose: 'codex',
    providerId: 'openai-codex',
    endpoint: '',
    account: '',
    createdAt: 2,
  },
  {
    id: 'images-api',
    name: 'OpenAI — изображения API',
    purpose: 'images',
    providerId: 'openai',
    endpoint: '',
    account: '',
    createdAt: 1,
  },
];
function useConnectionsState() {
  const { isDesktop, bootstrap } = useStorage();
  const [connections, setConnections] = useStoredState<Connection[]>(
    'connections',
    isDesktop ? [] : exampleConnections,
  );
  const [imageTool, setImageTool] = useStoredState('imageTool', { connectionId: '', modelId: '' });
  const { providerStatuses, setProviderStatus } = useProviderStatuses(
    connections.filter((connection) => connection.purpose !== 'images'),
    `${bootstrap?.folder ?? ''}\n${String(bootstrap?.sections.piPath ?? '')}`,
    bootstrap?.folder,
  );
  const images = useImageConnections(
    connections
      .filter((connection) => connection.purpose === 'images')
      .map((connection) => connection.id),
    bootstrap?.folder,
  );
  return {
    connections,
    imageTool,
    setImageTool,
    providerStatuses,
    setProviderStatus,
    ...images,
    saveConnection: (connection: Connection) =>
      setConnections((previous) =>
        [connection, ...previous.filter((item) => item.id !== connection.id)].sort(
          (a, b) => b.createdAt - a.createdAt,
        ),
      ),
    removeConnection: (id: string) =>
      setConnections((previous) => previous.filter((item) => item.id !== id)),
  };
}
export type ConnectionsValue = ReturnType<typeof useConnectionsState>;
export function ConnectionsProvider({ children }: { children: ReactNode }) {
  return (
    <ConnectionsContext.Provider value={useConnectionsState()}>
      {children}
    </ConnectionsContext.Provider>
  );
}
export function useConnections() {
  const value = useContext(ConnectionsContext);
  if (!value) throw new Error('ConnectionsProvider is missing');
  return value;
}
