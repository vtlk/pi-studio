import { retainVoiceDraft } from './VoiceDraftGuard';
import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Mic, Square, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@/shared/ui';
import { t, i18n } from '../../../shared/i18n';
import { prepareVoice, decodeVoice, transcribeVoice } from './voiceEngine';
import './voice.css';
export function VoiceInput({
  onText,
  disabled,
}: {
  onText: (text: string) => void;
  disabled?: boolean;
}) {
  useTranslation(undefined, { i18n });
  const [phase, setPhase] = useState<'idle' | 'loading' | 'recording' | 'transcribing'>('idle');
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const operation = useRef(0);
  const finishDraft = useRef<(() => void) | null>(null);
  const live = useRef(true),
    cancelled = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  useEffect(() => {
    if (phase !== 'loading') return;
    let alive = true;
    const poll = async () => {
      const state = await window.studio?.getVoiceModelState().catch(() => undefined);
      if (alive && state)
        setPercent(Math.min(100, Math.round((100 * state.downloaded) / Math.max(1, state.total))));
    };
    void poll();
    const timer = setInterval(() => void poll(), 500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [phase]);
  const start = async () => {
    const token = ++operation.current;
    cancelled.current = false;
    setError('');
    setPhase('loading');
    setPercent(0);
    try {
      await prepareVoice();
      if (
        !live.current ||
        cancelled.current ||
        operation.current !== token ||
        document.hidden ||
        !document.hasFocus()
      ) {
        if (live.current && operation.current === token) setPhase('idle');
        return;
      }
      if (!(await window.studio?.requestVoiceMicrophone()))
        throw new Error(t('Voice.microphoneDenied'));
      if (!live.current || cancelled.current || operation.current !== token) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (!live.current || cancelled.current || operation.current !== token) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const current = new MediaRecorder(stream);
      const finish = retainVoiceDraft();
      finishDraft.current = finish;
      const chunks: BlobPart[] = [];
      current.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      const maximum = setTimeout(() => {
        if (current.state === 'recording') current.stop();
      }, 180000);
      current.onstop = async () => {
        clearTimeout(maximum);
        stream.getTracks().forEach((track) => track.stop());
        recorder.current = null;
        streamRef.current = null;
        if (cancelled.current || operation.current !== token) {
          finish();
          return;
        }
        if (live.current) setPhase('transcribing');
        try {
          const audio = await decodeVoice(new Blob(chunks, { type: current.mimeType }));
          const text = await transcribeVoice(audio);
          if (!cancelled.current && operation.current === token) {
            if (text) onText(text);
            else if (live.current) setError(t('Voice.noSpeech'));
          }
        } catch (error) {
          if (live.current)
            setError(error instanceof Error ? error.message : t('Voice.inferenceFailed'));
        } finally {
          finish();
          if (finishDraft.current === finish) finishDraft.current = null;
          if (live.current) setPhase('idle');
        }
      };
      recorder.current = current;
      current.start(1000);
      setPhase('recording');
    } catch (error) {
      if (operation.current !== token) return;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      finishDraft.current?.();
      finishDraft.current = null;
      if (live.current) {
        setError(error instanceof Error ? error.message : t('Voice.microphoneDenied'));
        setPhase('idle');
      }
    }
  };
  return (
    <div className="voice-input" data-voice-phase={phase}>
      <IconButton
        className={phase === 'recording' ? 'voice-recording' : undefined}
        title={phase === 'recording' ? t('Voice.stop') : t('Voice.start')}
        disabled={disabled || phase === 'loading' || phase === 'transcribing'}
        onClick={() => {
          if (phase === 'recording') recorder.current?.stop();
          else void start();
        }}
      >
        {phase === 'loading' || phase === 'transcribing' ? (
          <LoaderCircle size={18} className="project-launch-spinner" />
        ) : phase === 'recording' ? (
          <Square size={18} />
        ) : (
          <Mic size={18} />
        )}
      </IconButton>
      {phase === 'loading' && (
        <>
          <small role="status">
            {percent < 100 ? t('Voice.downloading', { percent }) : t('Voice.loading')}
          </small>
          <IconButton
            title={t('Voice.cancel')}
            onClick={() => {
              cancelled.current = true;
              operation.current++;
              void (window.studio?.cancelVoiceModel() ?? Promise.resolve())
                .catch(() => {})
                .finally(() => {
                  if (live.current) setPhase('idle');
                });
            }}
          >
            <X size={14} />
          </IconButton>
        </>
      )}
      {phase === 'recording' && <small role="status">{t('Voice.recording')}</small>}
      {phase === 'transcribing' && <small role="status">{t('Voice.transcribing')}</small>}
      {error && (
        <small className="error-message" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
