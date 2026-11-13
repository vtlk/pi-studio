import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCharacterSvg } from '../src/shared/characterSvg.ts';
import { parseCharacterRig, rigPath } from '../src/shared/parseCharacterRig.ts';
import {
  characterPose,
  blinkRigPose,
  rigTrack,
  rigBlink,
  mixRigPose,
} from '../src/shared/characterMotion.ts';
import { rigActions, rigEmotions } from '../src/shared/characterRig.ts';
import { characterFixture } from '../scripts/fixtures/character-rig.ts';

const options = {
  action: 'idle',
  emotion: 'neutral',
  intensity: 1,
  headTilt: 0,
  gazeX: 0,
  gazeY: 0,
  autoGaze: false,
  manualGaze: false,
  blink: false,
};
test('data rig binds all actions, emotions, gaze, head and existing eyelid curves with deterministic continuous motion', () => {
  const source = characterFixture(),
    svg = parseCharacterSvg(source.svg),
    rig = parseCharacterRig(source.rig, svg.parts);
  for (const action of rigActions) {
    const a = characterPose(rig, { ...options, action }, 0.13),
      b = characterPose(rig, { ...options, action }, 0.41);
    assert.notDeepEqual(a, b);
    assert.ok(Object.values(a).every(Number.isFinite));
    assert.deepEqual(
      characterPose(rig, { ...options, action }, 0),
      characterPose(rig, { ...options, action }, rig.actions[action].duration),
    );
  }
  const mouth = rig.paths.find((path) => path.part === rig.parts.mouth)!;
  const mouths = new Set(
    rigEmotions.map((emotion) =>
      rigPath(mouth.template, characterPose(rig, { ...options, emotion }, 0)),
    ),
  );
  assert.equal(mouths.size, 8);
  for (const emotion of rigEmotions) {
    for (const gazeX of [-1, 0, 1])
      for (const gazeY of [-1, 0, 1]) {
        const pose = characterPose(
          rig,
          { ...options, emotion, intensity: 0, manualGaze: true, gazeX, gazeY, headTilt: 10 },
          0,
        );
        assert.equal(pose.pupilX, gazeX * 6);
        assert.equal(pose.pupilY, gazeY * 6);
        assert.equal(pose.headRotation, 10);
      }
  }
  const base = characterPose(rig, { ...options, emotion: 'angry' }, 0),
    closed = blinkRigPose(rig, { ...base, blinkL: 1, blinkR: 1 });
  assert.equal(closed.lidL, 114);
  assert.equal(closed.lidR, 114);
  assert.equal(base.pupilX, closed.pupilX);
  assert.equal(rigBlink(0.13), 1);
  assert.ok(rigBlink(0.22) > 0 && rigBlink(0.22) < 1);
  assert.equal(rigBlink(0.34), 0);
  assert.equal(mixRigPose({ ...base, blinkL: 0 }, { ...base, blinkL: 1 }, 0.05).blinkL, 1);
  for (let t = 0; t < 4; t += 0.01)
    assert.ok(
      rigTrack(
        [
          [0, 0],
          [1, 1],
          [2, -1],
          [4, 0],
        ],
        t,
        4,
      ) >= -1 &&
        rigTrack(
          [
            [0, 0],
            [1, 1],
            [2, -1],
            [4, 0],
          ],
          t,
          4,
        ) <= 1,
    );
  assert.ok(
    Math.abs(
      rigTrack(
        [
          [0, 0],
          [1, 1],
          [2, -1],
          [4, 0],
        ],
        3.9999,
        4,
      ) -
        rigTrack(
          [
            [0, 0],
            [1, 1],
            [2, -1],
            [4, 0],
          ],
          0.0001,
          4,
        ),
    ) < 0.001,
  );
});

test('rig validation rejects missing roles/channels, incompatible engines, malformed curves, broken loops and fake controls', () => {
  const source = characterFixture(),
    parts = parseCharacterSvg(source.svg).parts;
  for (const mutate of [
    (rig: typeof source.rig) => {
      rig.engine = 'unknown' as typeof rig.engine;
    },
    (rig: typeof source.rig) => {
      rig.parts.leftArm = 'absent';
    },
    (rig: typeof source.rig) => {
      rig.controls.gazeX.channel = 'armL';
    },
    (rig: typeof source.rig) => {
      rig.controls.blink.left = { mouthL: 0 };
    },
    (rig: typeof source.rig) => {
      rig.paths[0].template = 'M0 0L{toString} 3';
    },
    (rig: typeof source.rig) => {
      rig.paths[0].template = 'M0 0C{lidL} 3';
    },
    (rig: typeof source.rig) => {
      rig.actions.walk.tracks.legL = [
        [0, 0],
        [1.2, 1],
      ];
    },
    (rig: typeof source.rig) => {
      rig.actions.wave.tracks = {
        armL: [
          [0, 0],
          [2.4, 0],
        ],
      };
    },
    (rig: typeof source.rig) => {
      rig.defaults.lidL = NaN;
    },
    (rig: typeof source.rig) => {
      rig.emotions.angry = {};
    },
  ]) {
    const rig = structuredClone(source.rig);
    mutate(rig);
    assert.throws(() => parseCharacterRig(rig, parts));
  }
});

test('inline character SVG accepts scoped inert art and rejects scripts, CSS, external references, XML confusion and duplicate identities', () => {
  const valid = characterFixture().svg;
  assert.ok(parseCharacterSvg(valid).parts.size > 13);
  for (const svg of [
    valid.replace('<g data-part="body">', '<g data-part="body" onclick="alert(1)">'),
    valid.replace('</svg>', '<style>body{display:none}</style></svg>'),
    valid.replace('url(#shirt)', 'url(https://example.com/a)'),
    valid.replace('<g data-part="body">', '<g data-part="head">'),
    valid.replace('</svg>', '<foreignObject/></svg>'),
    valid.replace('</svg>', '<script/></svg>'),
    valid.replace('</svg>', '<image href="file:///secret"/></svg>'),
    valid.replace('</svg>', '<g xmlns="http://www.w3.org/1999/xhtml"/></svg>'),
    valid.replace('</svg>', ''),
    `<!DOCTYPE svg [<!ENTITY x "secret">]>${valid}`,
  ])
    assert.throws(() => parseCharacterSvg(svg));
});
