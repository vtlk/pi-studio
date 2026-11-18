import Worker from './voice.worker?worker';
import { t } from '../../../shared/i18n';
let worker: globalThis.Worker | undefined;
let ready = false,
  counter = 0;
let preparing: Promise<void> | undefined;
let inference = Promise.resolve();
let idle: ReturnType<typeof setTimeout> | undefined;
const pending = new Map<
  number,
  { resolve: (text: string) => void; reject: (error: Error) => void }
>();
function request(command: 'load' | 'transcribe', audio?: Float32Array) {
  clearTimeout(idle);
  worker ??= new Worker();
  worker.onmessage = ({ data }) => {
    const item = pending.get(data.id);
    if (!item) return;
    pending.delete(data.id);
    idle = setTimeout(() => {
      if (!pending.size) {
        worker?.terminate();
        worker = undefined;
        ready = false;
      }
    }, 5 * 60_000);
    if (data.error) {
      const error = new Error(t('Voice.inferenceFailed'));
      item.reject(error);
      for (const other of pending.values()) other.reject(error);
      pending.clear();
      clearTimeout(idle);
      worker?.terminate();
      worker = undefined;
      ready = false;
    } else item.resolve(data.text ?? '');
  };
  worker.onerror = () => {
    for (const item of pending.values()) item.reject(new Error(t('Voice.inferenceFailed')));
    pending.clear();
    worker?.terminate();
    worker = undefined;
    ready = false;
  };
  const id = ++counter;
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, command, audio }, audio ? [audio.buffer] : []);
  });
}
export function prepareVoice() {
  if (ready) return Promise.resolve();
  preparing ??= (async () => {
    if (!window.studio) throw new Error(t('Chat.desktopOnly'));
    await window.studio.prepareVoiceModel();
    await request('load');
    ready = true;
  })().finally(() => {
    preparing = undefined;
  });
  return preparing;
}
export async function transcribeVoice(audio: Float32Array) {
  await prepareVoice();
  const result = inference.then(() => request('transcribe', audio));
  inference = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
export async function decodeVoice(blob: Blob) {
  const context = new AudioContext({ sampleRate: 16000 });
  try {
    const audio = await context.decodeAudioData(await blob.arrayBuffer());
    const output = new Float32Array(Math.min(audio.length, 16000 * 180));
    for (let channel = 0; channel < audio.numberOfChannels; channel++) {
      const values = audio.getChannelData(channel);
      for (let index = 0; index < output.length; index++)
        output[index] += values[index] / audio.numberOfChannels;
    }
    return output;
  } finally {
    await context.close();
  }
}
