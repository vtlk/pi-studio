import { createContext } from 'react';
import type { LaunchContextValue } from './Launch';

export const LaunchContext = createContext<LaunchContextValue>(null);
