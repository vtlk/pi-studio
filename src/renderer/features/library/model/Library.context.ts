import { createContext } from 'react';
import type { LibraryContextValue } from './Library';

export const LibraryContext = createContext<LibraryContextValue>(null);
