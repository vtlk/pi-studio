import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import type { PlayerRef, RenderPlayPauseButton, RenderMuteButton } from '@remotion/player';
import { IconButton } from '@/shared/ui';
import { Tooltip } from '@/shared/ui/Tooltip';

/** Remotion owns the control and playback logic; this adapter supplies Studio's Lucide/Tooltip. */
function PlayGlyph({ playing, isBuffering }: { playing: boolean; isBuffering: boolean }) {
  useTranslation(undefined, { i18n });
  const ref = useRef<HTMLSpanElement>(null);
  const [focused, setFocused] = useState(false);
  const label = isBuffering
    ? t('RemotionControls.loadingVideo')
    : playing
      ? t('RemotionControls.pause')
      : t('RemotionControls.play');
  useEffect(() => {
    const button = ref.current?.closest('button');
    if (!button) return;
    button.setAttribute('aria-label', label);
    button.removeAttribute('title');
    const focus = () => setFocused(true),
      blur = () => setFocused(false);
    button.addEventListener('focus', focus);
    button.addEventListener('blur', blur);
    return () => {
      button.removeEventListener('focus', focus);
      button.removeEventListener('blur', blur);
    };
  }, [label]);
  return (
    <Tooltip label={label} open={focused || undefined}>
      <span
        ref={ref}
        className="remotion-play-glyph"
        data-player-playing={playing}
        aria-busy={isBuffering}
      >
        {isBuffering ? (
          <LoaderCircle size={18} />
        ) : playing ? (
          <Pause size={18} />
        ) : (
          <Play size={18} />
        )}
      </span>
    </Tooltip>
  );
}
export const renderRemotionPlay: RenderPlayPauseButton = (props) => <PlayGlyph {...props} />;
export function remotionMuteControl(player: React.RefObject<PlayerRef | null>): RenderMuteButton {
  return ({ muted, volume }) => (
    <IconButton
      title={muted || !volume ? t('RemotionControls.unmute') : t('RemotionControls.mute')}
      className="remotion-mute-control"
      onClick={() => {
        if (muted) player.current?.unmute();
        else player.current?.mute();
      }}
    >
      {muted || !volume ? <VolumeX size={18} /> : <Volume2 size={18} />}
    </IconButton>
  );
}
