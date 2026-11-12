import { useContext, useState, type ReactNode } from 'react';
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
const examples: Connection[] = [
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
  const [connections, setConnections] = useState(examples);
  const [imageTool, setImageTool] = useState({ connectionId: '', modelId: '' });
  return {
    connections,
    imageTool,
    setImageTool,
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
