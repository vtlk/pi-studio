import { createContext } from 'react';
import type { NoticeContextValue } from './Notice';

export const NoticeContext = createContext<NoticeContextValue>(null);
