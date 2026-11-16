import { createContext } from 'react';
import type { TeamTransfersValue } from './TeamTransfers';
export const TeamTransfersContext = createContext<TeamTransfersValue | null>(null);
