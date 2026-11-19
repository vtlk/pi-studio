export interface VoiceModelState {
  phase: 'idle' | 'checking' | 'downloading' | 'ready' | 'error';
  downloaded: number;
  total: number;
}
