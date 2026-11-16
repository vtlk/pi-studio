import { i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { PlaybackContext } from './Playback.context';
import { useContext, useState, type ReactNode } from 'react';

function usePlaybackState() {
  useTranslation(undefined, { i18n });
  const [scrub, setScrub] = useState(3.2);
  const [muted, setMuted] = useState(false);
  const [layers, setLayers] = useState(['Персонажи', 'Окружение', 'Речь', 'Атмосфера', 'Эффекты']);
  return { scrub, setScrub, muted, setMuted, layers, setLayers };
}
export type PlaybackContextValue = ReturnType<typeof usePlaybackState> | null;
export function PlaybackProvider({ children }: { children: ReactNode }) {
  useTranslation(undefined, { i18n });
  return <PlaybackContext.Provider value={usePlaybackState()}>{children}</PlaybackContext.Provider>;
}
export function usePlayback() {
  useTranslation(undefined, { i18n });
  const value = useContext(PlaybackContext);
  if (!value) throw new Error('PlaybackProvider is missing');
  return value;
}
