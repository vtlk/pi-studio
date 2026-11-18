import {
  env,
  AutomaticSpeechRecognitionPipeline,
  WhisperForConditionalGeneration,
  WhisperProcessor,
  WhisperTokenizer,
  WhisperFeatureExtractor,
} from '@huggingface/transformers';
import wasmModule from 'onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs?url';
import wasmBinary from 'onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url';

env.allowLocalModels = true;
env.allowRemoteModels = false;
env.useFS = false;
env.useBrowserCache = false;
env.useWasmCache = false;
env.localModelPath = 'studio-voice://models/';
const wasm = env.backends.onnx.wasm!;
wasm.wasmPaths = { mjs: wasmModule, wasm: wasmBinary };
wasm.numThreads = 1;
wasm.proxy = false;
let transcriber: AutomaticSpeechRecognitionPipeline | undefined;
let backend: 'wasm' | 'webgpu' = 'wasm';
self.onmessage = async ({
  data,
}: MessageEvent<{ id: number; command: 'load' | 'transcribe'; audio?: Float32Array }>) => {
  try {
    if (!transcriber) {
      const repo = 'onnx-community/whisper-large-v3-turbo';
      const gpu = (
        navigator as typeof navigator & {
          gpu?: {
            requestAdapter: () => Promise<{
              isFallbackAdapter?: boolean;
              info?: { isFallbackAdapter?: boolean };
            } | null>;
          };
        }
      ).gpu;
      const adapter = await gpu?.requestAdapter().catch(() => null);
      backend =
        adapter && !adapter.isFallbackAdapter && !adapter.info?.isFallbackAdapter
          ? 'webgpu'
          : 'wasm';
      const options = { device: backend, dtype: 'q4' as const, local_files_only: true };
      const [model, tokenizerData, tokenizerConfig, processorConfig] = await Promise.all([
        WhisperForConditionalGeneration.from_pretrained(repo, options).catch((error) => {
          if (backend === 'wasm') throw error;
          backend = 'wasm';
          return WhisperForConditionalGeneration.from_pretrained(repo, {
            ...options,
            device: 'wasm',
          });
        }),
        ...['tokenizer.json', 'tokenizer_config.json', 'preprocessor_config.json'].map(
          async (name) => {
            const response = await fetch(env.localModelPath + repo + '/' + name);
            if (!response.ok) throw Error('Local voice configuration missing');
            return response.json();
          },
        ),
      ]);
      // Explicit local constructors avoid the registry's remote file discovery.
      const tokenizer = new WhisperTokenizer(tokenizerData, tokenizerConfig);
      const processor = new WhisperProcessor(
        {},
        { tokenizer, feature_extractor: new WhisperFeatureExtractor(processorConfig) },
        null,
      );
      transcriber = new AutomaticSpeechRecognitionPipeline({
        task: 'automatic-speech-recognition',
        model,
        processor,
        tokenizer,
      });
    }
    if (data.command === 'load') {
      self.postMessage({ id: data.id, ready: true, backend });
      return;
    }
    if (
      !(data.audio instanceof Float32Array) ||
      !data.audio.length ||
      data.audio.length > 16000 * 180
    )
      throw Error('invalid-audio');
    const result = await transcriber(data.audio, {
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
    });
    self.postMessage({
      id: data.id,
      text: (Array.isArray(result) ? result[0].text : result.text).trim(),
    });
  } catch (error) {
    self.postMessage({
      id: data.id,
      error: true,
      reason: error instanceof Error ? (error.stack ?? error.message).slice(0, 3000) : 'runtime',
    });
  }
};
