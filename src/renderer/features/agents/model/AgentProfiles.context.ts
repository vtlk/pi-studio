import { createContext } from 'react';
import type { ProfilesContextValue } from './AgentProfiles';

export const ProfilesContext = createContext<ProfilesContextValue>(null);
