import { createContext } from 'react';
import type { NavigationContextValue } from './Navigation';

export const NavigationContext = createContext<NavigationContextValue>(null);
