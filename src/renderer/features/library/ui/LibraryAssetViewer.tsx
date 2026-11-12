import { useState } from 'react';
import type { Asset } from '@/entities/studio/types';
import { SectionMenu } from '@/shared/ui/SectionMenu';
import { defaultCharacterPreview, type CharacterPreviewOptions } from '../model/characterPreview';
import { AnimatedCharacter } from './AnimatedCharacter';
import { CharacterControls } from './CharacterControls';
import { LocationPreview } from './LocationPreview';

export function LibraryAssetViewer({ asset, character }: { asset: Asset; character: boolean }) {
  const [view, setView] = useState('SVG');
  const [options, setOptions] = useState(defaultCharacterPreview);
  const [blinkRequest, setBlinkRequest] = useState(0);
  const svg = view === 'SVG';
  const source = (svg ? (asset.vector ?? asset.image) : asset.reference) ?? asset.image;
  const update = (change: Partial<CharacterPreviewOptions>) =>
    setOptions((previous) => ({ ...previous, ...change }));
  return (
    <div className="library-viewer" data-kind={character ? 'character' : 'location'}>
      <section className="library-stage">
        <div className="library-stage-header">
          <h2>{asset.title}</h2>
        </div>
        <div className="library-format-layout">
          <SectionMenu
            label="Формат просмотра"
            items={['SVG', 'PNG-эталон'].map((label) => ({ id: label, label }))}
            selected={view}
            onSelect={setView}
          />
          {character ? (
            <div className="library-art">
              {svg ? (
                <AnimatedCharacter
                  key={asset.id}
                  asset={asset}
                  options={options}
                  blinkRequest={blinkRequest}
                />
              ) : (
                <img src={source} alt={asset.title} />
              )}
            </div>
          ) : (
            <LocationPreview key={`${asset.id}:${view}`} src={source} title={asset.title} />
          )}
        </div>
      </section>
      {character && (
        <aside className="library-controls">
          <CharacterControls
            value={options}
            onChange={update}
            disabled={!svg}
            onBlink={() => {
              setBlinkRequest((previous) => previous + 1);
            }}
          />
        </aside>
      )}
    </div>
  );
}
