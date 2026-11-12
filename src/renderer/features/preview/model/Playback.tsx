import { PlaybackContext } from './Playback.context';
import { useContext, useState, type ReactNode } from 'react';

function usePlaybackState() {
  const [scrub, setScrub] = useState(3.2);
  const [muted, setMuted] = useState(false);
  const [layers, setLayers] = useState(['Персонажи', 'Окружение', 'Речь', 'Атмосфера', 'Эффекты']);
  return { scrub, setScrub, muted, setMuted, layers, setLayers };
}
export type PlaybackContextValue = ReturnType<typeof usePlaybackState> | null;
export function PlaybackProvider({ children }: { children: ReactNode }) {
  return <PlaybackContext.Provider value={usePlaybackState()}>{children}</PlaybackContext.Provider>;
}
export function usePlayback() {
  const value = useContext(PlaybackContext);
  if (!value) throw new Error('PlaybackProvider is missing');
  return value;
}
