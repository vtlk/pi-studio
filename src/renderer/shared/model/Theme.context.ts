import { createContext } from 'react';
import type { ThemeState, ThemeChoice } from '../../../shared/appearance';

export const ThemeContext = createContext<
  (ThemeState & { choose: (theme: ThemeChoice) => void; toggle: () => void }) | null
>(null);
