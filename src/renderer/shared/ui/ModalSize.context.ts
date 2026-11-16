import { createContext } from 'react';

export type ModalSize = 'default' | 'wide';
/** Nested resource forms keep the explicitly chosen catalog width. */
export const ModalSizeContext = createContext<ModalSize>('default');
