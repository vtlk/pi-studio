import { createContext } from 'react';
import type { EditorValue } from './Editor';
export const EditorContext = createContext<EditorValue | null>(null);
