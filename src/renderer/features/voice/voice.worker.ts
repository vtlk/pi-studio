import {
  env,
  LogitsProcessor,
  LogitsProcessorList,
  Tensor,
  AutomaticSpeechRecognitionPipeline,
  WhisperForConditionalGeneration,
  WhisperProcessor,
  WhisperTokenizer,
  WhisperFeatureExtractor,
} from '@huggingface/transformers';
import { transcriptionPrefix, type WhisperLanguageVocabulary } from './whisperLanguage';
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
let vocabulary: WhisperLanguageVocabulary;
class OriginalLanguageTranscription extends LogitsProcessor {
  language?: string;
  _call(inputIds: bigint[][], logits: Tensor) {
    const scores = logits.data as Float32Array;
    const width = logits.dims.at(-1)!;
    for (let row = 0; row < inputIds.length; row++)
      this.language = transcriptionPrefix(
        inputIds[row],
        scores.subarray(row * width, (row + 1) * width),
        vocabulary,
        this.language,
      );
    return logits;
  }
}
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
      const [model, tokenizerData, tokenizerConfig, processorConfig, generationConfig] =
        await Promise.all([
          WhisperForConditionalGeneration.from_pretrained(repo, options).catch((error) => {
            if (backend === 'wasm') throw error;
            backend = 'wasm';
            return WhisperForConditionalGeneration.from_pretrained(repo, {
              ...options,
              device: 'wasm',
            });
          }),
          ...[
            'tokenizer.json',
            'tokenizer_config.json',
            'preprocessor_config.json',
            'generation_config.json',
          ].map(async (name) => {
            const response = await fetch(env.localModelPath + repo + '/' + name);
            if (!response.ok) throw Error('Local voice configuration missing');
            return response.json();
          }),
        ]);
      // Explicit local constructors avoid the registry's remote file discovery.
      const tokenizer = new WhisperTokenizer(tokenizerData, tokenizerConfig);
      const processor = new WhisperProcessor(
        {},
        { tokenizer, feature_extractor: new WhisperFeatureExtractor(processorConfig) },
        null,
      );
      vocabulary = generationConfig;
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
    // Start with only <|startoftranscript|>: predict the audio's language, then
    // force <|transcribe|><|notimestamps|>. This reuses the same encoder pass
    // and never falls through the SDK's hardcoded English default.
    const prefix = new OriginalLanguageTranscription();
    const processors = new LogitsProcessorList();
    processors.push(prefix);
    const result = await transcriber(data.audio, {
      decoder_input_ids: [vocabulary.decoder_start_token_id],
      logits_processor: processors,
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
    });
    if (!prefix.language) throw Error('Whisper language detection failed');
    self.postMessage({
      id: data.id,
      language: prefix.language,
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
