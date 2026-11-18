export interface VoiceModelState {
  phase: 'idle' | 'downloading' | 'ready' | 'error';
  downloaded: number;
  total: number;
}
