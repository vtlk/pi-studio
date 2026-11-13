import { rigActions, rigEmotions, rigRoles } from './characterRig.ts';
export const characterRigContract = {
  engine: 'pistudio-character-1',
  schemaVersion: 1,
  files:
    'For an animated character, asset.json files.vector names the SVG and files.rig names rig.json. PNG reference/preview remain required. A character without rig is static. No JavaScript/TSX/HTML is executed.',
  svg: 'A well-formed SVG with xmlns="http://www.w3.org/2000/svg", finite viewBox, and unique data-part on each independently controlled part. Body and head are g groups: body contains head/arms/legs, head contains pupils/lids/mouth/brows. Moving groups preserve existing transforms with outer wrappers; pivots are in the parent coordinate system. All local id/url(#id)/href references are scoped by the player. No style, scripts, events, animation, images, external resources or foreignObject. Allowed elements: svg g path rect circle ellipse polygon polyline line defs linearGradient radialGradient stop clipPath mask title desc. Use presentation attributes, not CSS.',
  shape: {
    schemaVersion: 1,
    engine: 'pistudio-character-1',
    parts: Object.fromEntries(rigRoles.map((role) => [role, `<unique data-part for ${role}>`])),
    defaults:
      'Object of 1–512 named finite numeric channels. Names use letters/digits/_/- with a leading letter. Every channel must be used by a transform/path. Values are absolute SVG coordinates, degrees, or scales; defaults are the neutral base.',
    transforms: [
      {
        part: '<data-part>',
        pivot: [120, 160],
        x: 'optional translation channel',
        y: 'optional translation channel',
        rotate: 'optional degree channel',
        scaleX: 'optional scale channel',
        scaleY: 'optional scale channel',
      },
    ],
    paths: [
      {
        part: '<data-part of an existing path>',
        template: 'M 94 {mouthLeftY} Q 120 {mouthCurveY} 146 {mouthRightY}',
      },
    ],
    actions: Object.fromEntries(
      rigActions.map((action) => [
        action,
        {
          duration: 4,
          tracks: {
            '<channel>': [
              [0, 0],
              [1, 2],
              [2, 0],
              [3, -2],
              [4, 0],
            ],
          },
        },
      ]),
    ),
    emotions: Object.fromEntries(
      rigEmotions.map((emotion) => [
        emotion,
        { '<channel>': 'absolute target value, not a delta' },
      ]),
    ),
    controls: {
      headTilt: '<rotate channel of head transform>',
      gazeX: { channel: '<x channel shared by both pupil transforms>', range: 6 },
      gazeY: { channel: '<y channel shared by both pupil transforms>', range: 6 },
      blink: {
        left: { '<left lid path coordinate channel>': 'absolute fully closed coordinate' },
        right: { '<right lid path coordinate channel>': 'absolute fully closed coordinate' },
      },
    },
  },
  requirements: [
    'Required roles: ' +
      rigRoles.join(', ') +
      '. Each role names a distinct existing data-part. Body/head/arms/legs/pupils have transforms. Lids/mouth/brows have path templates.',
    'A path template contains SVG M/L/H/V/C/S/Q/T/Z commands, numbers, and {channel} placeholders only. Maintain valid command topology in every expression; use native editable curves, not raster fragments or replacement faces.',
    'Actions are offsets added to the current base/emotion channels. Each of the six actions has a nonempty tracks object and actual movement. Keyframe pairs are [seconds, offset]. Strictly increasing times start at zero and end at duration (0.4–30 seconds). First and last offsets match for a seamless loop. Monotone cubic interpolation is supplied by Studio; no expressions or per-frame scripts.',
    'Make walk/run in place through opposing leg/arm rotations; wave one arm; gesture with asymmetry; think with a meaningful head/hand pose. Include subtle body breathing and delayed/asymmetric motion in the tracks. Author all coordinates and pivots for this artwork, not for a stock character.',
    'All eight emotions are partial absolute channel poses layered over defaults plus neutral. Every non-neutral emotion changes facial curves. Intensity blends from neutral to that pose. Coordinate mouth, brows, eyelids and head; preserve independent action selection.',
    'Manual gaze is absolute relative to default pupil position and overrides emotion/automatic gaze, independent of intensity. Choose ranges that keep pupils inside the whites. Head tilt adds user degrees around the neck pivot.',
    'Blink left/right maps affect only their own existing lid path coordinates; distinct channels for each eye. Fully closed values must cover the white/pupil with the existing lid, not scale or duplicate an eye. Player uses 110 ms close, 40 ms hold, 190 ms reopen and bypasses expression smoothing for blink.',
    'One visible clock. Hidden/unmounted/PNG/reduced-motion views stop playback. Updates do not rewrite application code. Rig validation checks data compatibility; Studio adds no artwork approval step.',
  ],
};
