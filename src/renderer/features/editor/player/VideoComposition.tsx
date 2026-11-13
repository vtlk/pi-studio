import { AbsoluteFill, Img, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import { Audio, Video } from '@remotion/media';
import type { ValidatedVideoProject, VideoItem, VideoTrack } from '../../../../shared/video';
import { evaluateVideoTransform } from '../../../../shared/videoFrame';
import { StereoPan } from './StereoPan';

type VideoCompositionProps = { document: ValidatedVideoProject };
// Stable identity keeps Remotion's native decoder alive across frame/volume changes.
const failMedia = () => 'fail' as const;

function TimelineLayer({
  item,
  type,
  document,
}: {
  item: VideoItem;
  type: VideoTrack['type'];
  document: ValidatedVideoProject;
}) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const asset = document.assets.find((asset) => asset.id === item.assetId);
  const transform = evaluateVideoTransform(item, frame);
  const media = {
    src: asset?.url ?? '',
    volume: item.volume ?? 1,
    trimBefore: item.sourceFrom ?? 0,
    durationInFrames: item.duration,
  };
  if (type === 'audio')
    return (
      <StereoPan pan={item.pan ?? 0}>
        <Audio {...media} onError={failMedia} />
      </StereoPan>
    );
  return (
    <div
      data-montage-item={item.id}
      style={{
        position: 'absolute',
        left: transform.x,
        top: transform.y,
        width: item.width ?? width,
        height: item.height ?? height,
        transform: `rotate(${transform.rotation}deg) scale(${transform.scale})`,
        transformOrigin: 'center',
        opacity: transform.opacity,
        overflow: 'hidden',
      }}
    >
      {type === 'subtitles' ? (
        <div
          style={{
            width: '100%',
            minHeight: '100%',
            boxSizing: 'border-box',
            color: item.color ?? '#FFFFFF',
            background: item.background ?? '#000000B3',
            fontSize: item.fontSize ?? Math.round(width * 0.045),
            fontWeight: 700,
            fontFamily: 'Arial, sans-serif',
            lineHeight: 1.25,
            whiteSpace: 'pre-wrap',
            padding: (item.fontSize ?? Math.round(width * 0.045)) * 0.4,
            textAlign: item.align ?? 'center',
            overflowWrap: 'anywhere',
          }}
        >
          {item.text!.toUpperCase()}
        </div>
      ) : asset?.type === 'image' ? (
        <Img
          src={asset.url}
          style={{ width: '100%', height: '100%', objectFit: item.fit ?? 'contain' }}
        />
      ) : (
        <StereoPan pan={item.pan ?? 0}>
          <Video
            {...media}
            objectFit={item.fit ?? 'contain'}
            style={{ width: '100%', height: '100%' }}
            onError={failMedia}
          />
        </StereoPan>
      )}
    </div>
  );
}

/** Trusted, bundled Remotion composition. Agent files supply only validated data and assets. */
export function VideoComposition({ document }: VideoCompositionProps) {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ backgroundColor: document.timeline.background }}>
      {document.timeline.tracks.flatMap((track) =>
        track.items.map((item) => (
          <Sequence
            key={item.id}
            name={item.name}
            from={item.from}
            durationInFrames={item.duration}
            premountFor={fps}
          >
            <TimelineLayer item={item} type={track.type} document={document} />
          </Sequence>
        )),
      )}
    </AbsoluteFill>
  );
}
