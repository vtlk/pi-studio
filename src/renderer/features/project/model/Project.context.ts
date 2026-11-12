import { createContext } from 'react';
import type { ProjectContextValue } from './Project';

export const ProjectContext = createContext<ProjectContextValue>(null);
