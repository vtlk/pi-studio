import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import type { VideoItem, ResolvedVideoAsset } from '../../../../shared/video';

export function ClipProperties({
  selected,
  assets,
}: {
  selected?: VideoItem;
  assets: ResolvedVideoAsset[];
}) {
  useTranslation(undefined, { i18n });
  return (
    <aside className="editor-inspector">
      <h3>{t('ClipProperties.clipProperties')}</h3>
      {selected ? (
        <>
          <p>{selected.name}</p>
          <dl className="data-list">
            <dt>{t('ClipProperties.startFrames')}</dt>
            <dd>{selected.from}</dd>
            <dt>{t('ClipProperties.durationFrames')}</dt>
            <dd>{selected.duration}</dd>
            <dt>{t('ClipProperties.volume')}</dt>
            <dd>{Math.round((selected.volume ?? 1) * 100)}%</dd>
            {assets.some((asset) => asset.id === selected.assetId && asset.type !== 'image') && (
              <>
                <dt>{t('ClipProperties.pan')}</dt>
                <dd>
                  {!selected.pan
                    ? t('ClipProperties.center')
                    : t('ClipProperties.summary', {
                        value1:
                          selected.pan < 0 ? t('ClipProperties.left') : t('ClipProperties.right'),
                        value2: Math.round(Math.abs(selected.pan) * 100),
                      })}
                </dd>
              </>
            )}
          </dl>
          {selected.text && (
            <>
              <h3>{t('ClipProperties.subtitles')}</h3>
              <p>{selected.text.toUpperCase()}</p>
            </>
          )}
        </>
      ) : (
        <p>{t('ClipProperties.selectAClipOnTheTimeline')}</p>
      )}
      <p className="subtle">{t('ClipProperties.editTheMontageInTheAgentS')}</p>
    </aside>
  );
}
