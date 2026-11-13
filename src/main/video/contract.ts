const string = { type: 'string', minLength: 1, maxLength: 500 };
const integer = (minimum: number, maximum: number) => ({ type: 'integer', minimum, maximum });
const number = (minimum: number, maximum: number) => ({ type: 'number', minimum, maximum });
const color = { type: 'string', pattern: '^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$' };
const transform = {
  x: number(-15360, 15360),
  y: number(-15360, 15360),
  scale: number(0.001, 100),
  rotation: number(-36000, 36000),
  opacity: number(0, 1),
};
const object = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const item = object(
  {
    ...transform,
    id: { ...string, maxLength: 200 },
    name: string,
    from: integer(0, 35999),
    duration: integer(1, 36000),
    assetId: { ...string, maxLength: 200 },
    text: { ...string, maxLength: 10000 },
    sourceFrom: integer(0, 216000),
    width: number(1, 15360),
    height: number(1, 15360),
    volume: number(0, 4),
    pan: number(-1, 1),
    fontSize: number(1, 500),
    color,
    background: color,
    fit: { enum: ['contain', 'cover'] },
    align: { enum: ['left', 'center', 'right'] },
    keyframes: {
      type: 'array',
      maxItems: 1000,
      items: object(
        { ...transform, frame: integer(0, 35999), ease: { enum: ['linear', 'hold', 'smooth'] } },
        ['frame'],
      ),
    },
  },
  ['id', 'name', 'from', 'duration'],
);

/** Versioned public data contract for the bundled Remotion composition, not executable TSX. */
export const videoContract = {
  viewer: { package: '@remotion/player', version: '4.0.543', editor: 'remotion-player' },
  defaults: { width: 1080, height: 1920, fps: 30, uppercaseSubtitles: true },
  manifestSchema: object(
    {
      type: { const: 'pi-studio.video-project' },
      schemaVersion: { const: 1 },
      editor: { const: 'remotion-player' },
      name: string,
      scope: { enum: ['scene', 'film'] },
      state: { ...string, maxLength: 2000 },
    },
    ['type', 'schemaVersion', 'editor', 'name', 'scope', 'state'],
  ),
  timelineSchema: object(
    {
      type: { const: 'pi-studio.timeline' },
      schemaVersion: { const: 1 },
      width: { ...integer(2, 3840), multipleOf: 2 },
      height: { ...integer(2, 3840), multipleOf: 2 },
      fps: integer(1, 60),
      durationInFrames: integer(1, 36000),
      background: color,
      assets: {
        type: 'array',
        maxItems: 1000,
        items: object(
          {
            id: { ...string, maxLength: 200 },
            type: { enum: ['image', 'video', 'audio'] },
            src: { ...string, maxLength: 2000 },
          },
          ['id', 'type', 'src'],
        ),
      },
      tracks: {
        type: 'array',
        maxItems: 128,
        items: {
          ...object(
            {
              id: { ...string, maxLength: 200 },
              name: string,
              type: { enum: ['visual', 'audio', 'subtitles'] },
              items: { type: 'array', maxItems: 5000, items: item },
            },
            ['id', 'name', 'type', 'items'],
          ),
          allOf: [
            {
              if: { properties: { type: { const: 'subtitles' } } },
              then: { properties: { items: { items: { required: ['text'] } } } },
              else: { properties: { items: { items: { required: ['assetId'] } } } },
            },
          ],
        },
      },
    },
    ['type', 'schemaVersion', 'width', 'height', 'fps', 'durationInFrames', 'assets', 'tracks'],
  ),
  rules: [
    'Write all files under your output directory. Asset src and manifest state are relative to the MANIFEST directory. No URLs, absolute paths, symlinks, scripts or executable compositions. Publish the manifest last.',
    'All asset, track and item IDs are unique across the document. Each item fits within the timeline. Its referenced source must contain the full requested sourceFrom+duration, in timeline frames. Maximum duration is 600 seconds and total items <=5000.',
    'Track order is paint order, bottom to top. visual items reference image/video assets; audio items reference audio assets; subtitles contain text. Items on one track may overlap. Empty areas use background.',
    'Coordinates are composition pixels. x/y default 0; width/height default composition size. Scale/rotation pivot at the item center. scale=1, rotation=0, opacity=1, fit=contain, volume=1, sourceFrom=0 by default. Audio and video sound support static stereo pan from -1 (left) to 1 (right), default 0 (unchanged stereo). Nonzero pan on an image or subtitle is invalid. Panning uses Web Audio StereoPanner equal-power mixing; multi-channel inputs are downmixed to stereo.',
    'Keyframe frame is local to the item. Sparse channels interpolate independently. ease on the left key controls linear/hold/smooth interpolation to the next; endpoint values hold. Subtitles are displayed uppercase.',
    'Images: static SVG, PNG, JPEG, WebP. SVG must be self-contained with no scripts, external references, foreignObject or SMIL. Animate image layers through timeline keyframes. Video: MP4/M4V/MOV/WebM; audio: WAV/MP3/M4A/AAC/OGG/FLAC. Actual decoding depends on supported codecs; use H.264 MP4 and PCM WAV for predictable macOS playback.',
    'Changes invalidate the document revision (SHA-256 includes manifest, timeline and every asset). Rendering is performed by the agent through bash/tools; Studio adds no approval gate.',
  ],
  example: {
    manifest: {
      type: 'pi-studio.video-project',
      schemaVersion: 1,
      editor: 'remotion-player',
      name: 'Название мультфильма',
      scope: 'film',
      state: './timeline.json',
    },
    timeline: {
      type: 'pi-studio.timeline',
      schemaVersion: 1,
      width: 1080,
      height: 1920,
      fps: 30,
      durationInFrames: 150,
      background: '#102030',
      assets: [],
      tracks: [
        {
          id: 'titles',
          name: 'Титры',
          type: 'subtitles',
          items: [
            {
              id: 'title',
              name: 'Название',
              from: 0,
              duration: 150,
              text: 'Название мультфильма',
              y: 800,
              height: 300,
              fontSize: 80,
              keyframes: [
                { frame: 0, opacity: 0 },
                { frame: 20, opacity: 1 },
              ],
            },
          ],
        },
      ],
    },
  },
};
