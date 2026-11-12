import type { PiCheck } from './contracts';
export interface StartupState {
  phase: 'checking' | 'downloading' | 'installing' | 'verifying' | 'ready' | 'error' | 'skipped';
  message: string;
  progress?: number;
  pi?: PiCheck;
}
