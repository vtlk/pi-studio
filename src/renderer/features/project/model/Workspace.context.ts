import { createContext } from 'react';
import type { WorkspaceContextValue } from './Workspace';

export const WorkspaceContext = createContext<WorkspaceContextValue>(null);
