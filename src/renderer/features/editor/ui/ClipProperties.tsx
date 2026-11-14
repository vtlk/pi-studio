import type { VideoItem, ResolvedVideoAsset } from '../../../../shared/video';

export function ClipProperties({
  selected,
  assets,
}: {
  selected?: VideoItem;
  assets: ResolvedVideoAsset[];
}) {
  return (
    <aside className="editor-inspector">
      <h3>Свойства клипа</h3>
      {selected ? (
        <>
          <p>{selected.name}</p>
          <dl className="data-list">
            <dt>Начало, кадры</dt>
            <dd>{selected.from}</dd>
            <dt>Длительность, кадры</dt>
            <dd>{selected.duration}</dd>
            <dt>Громкость</dt>
            <dd>{Math.round((selected.volume ?? 1) * 100)}%</dd>
            {assets.some((asset) => asset.id === selected.assetId && asset.type !== 'image') && (
              <>
                <dt>Панорама</dt>
                <dd>
                  {!selected.pan
                    ? 'Центр'
                    : `${selected.pan < 0 ? 'Влево' : 'Вправо'} ${Math.round(Math.abs(selected.pan) * 100)}%`}
                </dd>
              </>
            )}
          </dl>
          {selected.text && (
            <>
              <h3>Субтитры</h3>
              <p>{selected.text.toUpperCase()}</p>
            </>
          )}
        </>
      ) : (
        <p>Выберите клип на таймлайне.</p>
      )}
      <p className="subtle">Правки монтажа выполняются в диалоге агента в Pi.</p>
    </aside>
  );
}
