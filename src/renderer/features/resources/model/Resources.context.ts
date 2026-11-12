import { createContext } from 'react';
import type { ResourcesValue } from './Resources';

export const ResourcesContext = createContext<ResourcesValue | null>(null);
