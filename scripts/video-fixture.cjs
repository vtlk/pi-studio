const { mkdir, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');

/** Small data-only fixture, confined to an isolated smoke studio. Never installed as user data. */
async function writeVideoFixture(output) {
  await mkdir(join(output, 'assets'), { recursive: true });
  await writeFile(
    join(output, 'assets/square.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#ff0000"/></svg>',
  );
  const samples = 44100 * 2,
    wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(44100, 24);
  wav.writeUInt32LE(88200, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    wav.writeInt16LE(Math.round(Math.sin((i * Math.PI * 2 * 440) / 44100) * 1200), 44 + i * 2);
  await writeFile(join(output, 'assets/tone.wav'), wav);
  execFileSync('/opt/homebrew/bin/ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=green:s=80x80:r=10:d=2',
    '-i',
    join(output, 'assets/tone.wav'),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    '-y',
    join(output, 'assets/clip.mp4'),
  ]);
  const timeline = {
    type: 'pi-studio.timeline',
    schemaVersion: 1,
    width: 320,
    height: 480,
    fps: 10,
    durationInFrames: 20,
    background: '#102030',
    assets: [
      { id: 'square', type: 'image', src: './assets/square.svg' },
      { id: 'video', type: 'video', src: './assets/clip.mp4' },
      { id: 'voice', type: 'audio', src: './assets/tone.wav' },
    ],
    tracks: [
      {
        id: 'pictures',
        name: 'Изображение и видео',
        type: 'visual',
        items: [
          {
            id: 'moving-square',
            name: 'Движущийся квадрат',
            from: 0,
            duration: 20,
            assetId: 'square',
            width: 40,
            height: 40,
            keyframes: [
              { frame: 0, x: 0 },
              { frame: 19, x: 100 },
            ],
          },
          {
            id: 'video-clip',
            name: 'Видеоклип',
            from: 0,
            duration: 20,
            assetId: 'video',
            x: 100,
            y: 100,
            width: 80,
            height: 80,
            volume: 0,
          },
        ],
      },
      {
        id: 'audio',
        name: 'Звук',
        type: 'audio',
        items: [
          {
            id: 'voice-clip',
            name: 'Озвучка',
            from: 0,
            duration: 20,
            assetId: 'voice',
            volume: 0.3,
            pan: 0,
          },
        ],
      },
      {
        id: 'captions',
        name: 'Субтитры',
        type: 'subtitles',
        items: [
          {
            id: 'caption',
            name: 'Подпись',
            from: 0,
            duration: 20,
            text: 'проверка монтажа',
            y: 400,
            height: 80,
            fontSize: 24,
          },
        ],
      },
    ],
  };
  await writeFile(join(output, 'timeline.json'), JSON.stringify(timeline));
  await writeFile(
    join(output, 'film.pistudio.json'),
    JSON.stringify({
      type: 'pi-studio.video-project',
      schemaVersion: 1,
      editor: 'remotion-player',
      name: 'Проверка просмотра',
      scope: 'film',
      state: './timeline.json',
    }),
  );
  return timeline;
}
module.exports = { writeVideoFixture };
