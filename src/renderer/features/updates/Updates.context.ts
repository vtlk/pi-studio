import { createContext } from 'react';
import type { UpdateState } from '../../../shared/updates';

export interface UpdatesValue {
  state?: UpdateState;
  frozen: boolean;
  open: boolean;
  manual: boolean;
  show(): void;
  hide(): void;
  request(): void;
  check(): void;
}
export const UpdatesContext = createContext<UpdatesValue | null>(null);
