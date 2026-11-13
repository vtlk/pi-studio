import { useEffect, useId, useRef, useState } from 'react';
import type { Asset } from '@/entities/studio/types';
import type { CharacterPreviewOptions } from '../model/characterPreview';
import { loadCharacterRuntime } from '../runtime/characterRuntime';
import { CharacterPlayer } from '../runtime/CharacterPlayer';
import { dataCharacterRuntime } from '../runtime/dataCharacterRuntime';

export function AnimatedCharacter({
  asset,
  options,
  blinkRequest,
}: {
  asset: Asset;
  options: CharacterPreviewOptions;
  blinkRequest: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<CharacterPlayer | null>(null);
  const latestOptions = useRef(options);
  const prefix = useId().replace(/[^a-z0-9_-]/gi, '');
  const [error, setError] = useState('');
  const nativeVersion = asset.library?.version;
  const nativeRevision = asset.library?.revision;
  useEffect(() => {
    latestOptions.current = options;
    player.current?.setOptions(options);
  }, [options]);
  useEffect(() => {
    let cancelled = false;
    setError('');
    const loading =
      nativeVersion !== undefined
        ? window
            .studio!.readLibraryCharacter(asset.id, nativeVersion, nativeRevision!)
            .then((source) => dataCharacterRuntime(source, asset.id))
        : loadCharacterRuntime();
    loading
      .then((runtime) => {
        if (cancelled || !host.current) return;
        const design = runtime.designs[asset.id];
        if (!design)
          throw new Error('Для этого персонажа ещё не подключён совместимый анимационный риг.');
        player.current = new CharacterPlayer(
          host.current,
          runtime,
          design,
          latestOptions.current,
          `preview-${prefix}`,
          asset.title,
        );
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : 'Ошибка предпросмотра.');
      });
    return () => {
      cancelled = true;
      player.current?.dispose();
      player.current = null;
    };
  }, [asset.id, asset.title, nativeVersion, nativeRevision, prefix]);
  useEffect(() => {
    if (blinkRequest) player.current?.blink();
  }, [blinkRequest]);
  return (
    <div className="animated-character" ref={host}>
      {error && (
        <div className="character-preview-error">
          <img src={asset.vector ?? asset.image} alt={asset.title} />
          <p role="alert">{error}</p>
        </div>
      )}
    </div>
  );
}
