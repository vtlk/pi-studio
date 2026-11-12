import { createContext } from 'react';
import type { ConnectionsValue } from './Connections';
export const ConnectionsContext = createContext<ConnectionsValue | null>(null);
