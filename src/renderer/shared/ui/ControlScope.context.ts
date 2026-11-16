import { createContext, useContext } from 'react';

/** Also follows shared dialogs and Radix portals outside the page's DOM subtree. */
export const ControlScopeContext = createContext<'projects' | undefined>(undefined);
export function useControlScope() {
  return useContext(ControlScopeContext);
}
