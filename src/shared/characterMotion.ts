import {
  type CharacterRig,
  type RigPose,
  type RigAction,
  type RigEmotion,
} from './characterRig.ts';

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const smooth = (n: number) => {
  n = clamp(n, 0, 1);
  return n * n * (3 - 2 * n);
};
export interface CharacterMotionOptions {
  action: string;
  emotion: string;
  intensity: number;
  headTilt: number;
  gazeX: number;
  gazeY: number;
  autoGaze: boolean;
  manualGaze: boolean;
  blink: boolean;
}
/** Monotone cubic interpolation: continuous loop velocity and no overshoot. */
export function rigTrack(keys: [number, number][], time: number, duration: number) {
  time = ((time % duration) + duration) % duration;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1][0] <= time) i++;
  const [a, av] = keys[i],
    [b, bv] = keys[i + 1],
    h = b - a,
    d = (bv - av) / h;
  const prev = i === 0 ? [keys.at(-2)![0] - duration, keys.at(-2)![1]] : keys[i - 1];
  const next = i + 2 >= keys.length ? [keys[1][0] + duration, keys[1][1]] : keys[i + 2];
  const left = (av - prev[1]) / (a - prev[0]),
    right = (next[1] - bv) / (next[0] - b);
  const slope = (a: number, b: number) =>
    a * b <= 0
      ? 0
      : Math.sign(a) *
        Math.min(Math.abs((2 * a * b) / (a + b)), 3 * Math.min(Math.abs(a), Math.abs(b)));
  const m0 = slope(left, d),
    m1 = slope(d, right),
    t = (time - a) / h,
    t2 = t * t,
    t3 = t2 * t;
  return clamp(
    (2 * t3 - 3 * t2 + 1) * av +
      (t3 - 2 * t2 + t) * h * m0 +
      (-2 * t3 + 3 * t2) * bv +
      (t3 - t2) * h * m1,
    Math.min(av, bv),
    Math.max(av, bv),
  );
}
export function rigBlink(time: number, offset = 0) {
  const t = time - offset;
  if (t < 0 || t >= 0.34) return 0;
  if (t < 0.11) return smooth(t / 0.11);
  if (t < 0.15) return 1;
  return Math.pow(1 - (t - 0.15) / 0.19, 3);
}
export function characterPose(
  rig: CharacterRig,
  options: CharacterMotionOptions,
  time: number,
): RigPose {
  const intensity = clamp(options.intensity, 0, 1),
    pose = { ...rig.defaults, ...rig.emotions.neutral };
  const emotion = rig.emotions[options.emotion as RigEmotion] ?? rig.emotions.neutral;
  for (const [key, value] of Object.entries(emotion)) pose[key] += (value - pose[key]) * intensity;
  const action = rig.actions[options.action as RigAction] ?? rig.actions.idle;
  for (const [key, keys] of Object.entries(action.tracks))
    pose[key] += rigTrack(keys, time, action.duration) * intensity;
  const { gazeX, gazeY, headTilt } = rig.controls;
  if (options.manualGaze) {
    pose[gazeX.channel] = rig.defaults[gazeX.channel] + clamp(options.gazeX, -1, 1) * gazeX.range;
    pose[gazeY.channel] = rig.defaults[gazeY.channel] + clamp(options.gazeY, -1, 1) * gazeY.range;
  } else if (options.autoGaze) {
    const t = time % 8;
    const x = rigTrack(
        [
          [0, 0],
          [2, 0],
          [2.6, 0.65],
          [4, 0.65],
          [4.6, -0.5],
          [6, -0.5],
          [6.6, 0],
          [8, 0],
        ],
        t,
        8,
      ),
      y = rigTrack(
        [
          [0, 0],
          [2, 0],
          [2.6, -0.2],
          [4, -0.2],
          [4.6, 0.25],
          [6, 0.25],
          [6.6, 0],
          [8, 0],
        ],
        t,
        8,
      );
    pose[gazeX.channel] += x * gazeX.range;
    pose[gazeY.channel] += y * gazeY.range;
  }
  pose[headTilt] += clamp(options.headTilt, -10, 10);
  pose.blinkL = options.blink ? rigBlink(time % 4.1, 3.4) : 0;
  pose.blinkR = options.blink ? rigBlink(time % 4.1, 3.41) : 0;
  return pose;
}
export function mixRigPose(previous: RigPose | null, next: RigPose, alpha: number): RigPose {
  if (!previous) return { ...next };
  return Object.fromEntries(
    Object.entries(next).map(([key, value]) => [
      key,
      key === 'blinkL' || key === 'blinkR'
        ? value
        : (previous[key] ?? value) + (value - (previous[key] ?? value)) * clamp(alpha, 0, 1),
    ]),
  );
}
export function blinkRigPose(rig: CharacterRig, pose: RigPose) {
  const drawn = { ...pose };
  for (const side of ['left', 'right'] as const) {
    const amount = clamp(pose[side === 'left' ? 'blinkL' : 'blinkR'] ?? 0, 0, 1);
    for (const [key, value] of Object.entries(rig.controls.blink[side]))
      drawn[key] += (value - drawn[key]) * amount;
  }
  return drawn;
}
