import type { Language } from './i18n/locale.ts';
export interface ComputerPoint {
  x: number;
  y: number;
}

/** Presentation only: no tool arguments, paths, credentials or runtime lease IDs. */
export interface ComputerFeedbackState {
  agentName: string;
  action: string;
  actionName?: string;
  language?: Language;
  point?: ComputerPoint;
  click: number;
  badgeTop: number;
}

export const computerFeedbackEvent = 'pi-studio-computer-feedback';
