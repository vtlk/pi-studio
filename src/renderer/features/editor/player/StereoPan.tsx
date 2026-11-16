import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { Internals } from 'remotion';

interface Routing {
  context: AudioContext;
  destination: GainNode;
  input: GainNode;
  pan: number;
}

/** Pinned Remotion 4.0.543 adapter: media tags route to SharedAudioContext.gainNode.
 * Keep its clock, scheduling, master gain and mute intact; insert only a per-clip panner.
 * This internal boundary must pass the real Electron channel/lifecycle smoke before upgrades.
 */
export function StereoPan({ pan, children }: { pan: number; children: ReactNode }) {
  useTranslation(undefined, { i18n });
  const shared = useContext(Internals.SharedAudioContext);
  const context = shared?.audioContext;
  const destination = shared?.gainNode;
  const [routing, setRouting] = useState<Routing>();
  useLayoutEffect(() => {
    if (!context || !destination) return;
    const input = context.createGain();
    const panner = context.createStereoPanner();
    panner.pan.value = pan;
    input.connect(panner);
    panner.connect(destination);
    setRouting({ context, destination, input, pan });
    return () => {
      input.disconnect();
      panner.disconnect();
    };
  }, [context, destination, pan]);
  const value = useMemo(
    () => (shared && routing ? { ...shared, gainNode: routing.input } : null),
    [shared, routing],
  );
  if (!shared) throw new Error(t('StereoPan.stereoPanRequiresTheRemotionPlayerAudio'));
  // No unpanned playback while the native context or per-clip routing is preparing.
  if (
    !routing ||
    routing.context !== context ||
    routing.destination !== destination ||
    routing.pan !== pan
  )
    return null;
  return (
    <Internals.SharedAudioContext.Provider value={value}>
      {children}
    </Internals.SharedAudioContext.Provider>
  );
}
