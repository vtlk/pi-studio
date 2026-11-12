import { createContext } from 'react';
import type { PlaybackContextValue } from './Playback';

export const PlaybackContext = createContext<PlaybackContextValue>(null);
