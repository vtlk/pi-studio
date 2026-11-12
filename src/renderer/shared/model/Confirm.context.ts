import { createContext } from 'react';
import type { ConfirmContextValue } from './Confirm';

export const ConfirmContext = createContext<ConfirmContextValue>(null);
