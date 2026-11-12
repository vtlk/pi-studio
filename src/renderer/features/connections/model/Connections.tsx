import { useStorage, useStoredState } from '@/shared/storage/Storage';
import { useContext, useState, type ReactNode } from 'react';
import type { ProviderStatus } from '../../../../shared/contracts';
import { ConnectionsContext } from './Connections.context';
export interface Connection {
  id: string;
  name: string;
  purpose: 'codex' | 'images' | 'pi' | 'compatible' | 'local';
  providerId: string;
  endpoint: string;
  account: string;
  createdAt: number;
}
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
  const { isDesktop } = useStorage();
  const [connections, setConnections] = useStoredState<Connection[]>(
    'connections',
    isDesktop ? [] : exampleConnections,
  );
  const [imageTool, setImageTool] = useStoredState('imageTool', { connectionId: '', modelId: '' });
  const [providerStatuses, setProviderStatuses] = useState<
    Record<string, ProviderStatus['status']>
  >({});
  return {
    connections,
    imageTool,
    setImageTool,
    providerStatuses,
    setProviderStatus: (result: ProviderStatus) =>
      setProviderStatuses((previous) => ({ ...previous, [result.provider]: result.status })),
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
