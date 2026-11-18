/** Whisper language detection predicts one language token, with all text/task tokens masked. */
export function maskLanguageScores(scores: Float32Array, width: number, tokens: number[]) {
  const allowed = new Set(tokens);
  if (
    !width ||
    scores.length % width ||
    !tokens.length ||
    tokens.some((id) => id < 0 || id >= width)
  )
    throw Error('Invalid Whisper language vocabulary');
  for (let offset = 0; offset < scores.length; offset += width) {
    if (!tokens.some((id) => Number.isFinite(scores[offset + id])))
      throw Error('Whisper language detection produced no language scores');
    for (let id = 0; id < width; id++) if (!allowed.has(id)) scores[offset + id] = -Infinity;
  }
}
export function languageCode(languages: Record<string, number>, token: bigint | number) {
  const name = Object.keys(languages).find((name) => languages[name] === Number(token));
  if (!name || !/^<\|[a-z]{2,3}\|>$/.test(name))
    throw Error('Whisper did not identify a supported language');
  return name.slice(2, -2);
}
export interface WhisperLanguageVocabulary {
  decoder_start_token_id: number;
  lang_to_id: Record<string, number>;
  task_to_id: Record<string, number>;
  no_timestamps_token_id: number;
}
/** Construct the normal Whisper prefix without the SDK's implicit English language. */
export function transcriptionPrefix(
  prefix: bigint[],
  scores: Float32Array,
  vocabulary: WhisperLanguageVocabulary,
  previousLanguage?: string,
) {
  if (Number(prefix[0]) !== vocabulary.decoder_start_token_id)
    throw Error('Invalid Whisper transcription prefix');
  const force = (token: number) => {
    if (!Number.isInteger(token) || token < 0 || token >= scores.length)
      throw Error('Invalid Whisper transcription token');
    scores.fill(-Infinity);
    scores[token] = 0;
  };
  if (prefix.length === 1) {
    if (previousLanguage) force(vocabulary.lang_to_id[`<|${previousLanguage}|>`]);
    else maskLanguageScores(scores, scores.length, Object.values(vocabulary.lang_to_id));
    return previousLanguage;
  }
  const language = languageCode(vocabulary.lang_to_id, prefix[1]);
  if (prefix.length === 2) force(vocabulary.task_to_id.transcribe);
  else if (prefix.length === 3) force(vocabulary.no_timestamps_token_id);
  return language;
}
