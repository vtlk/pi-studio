import { LibraryAssetViewer } from './LibraryAssetViewer';
import { AddArea } from '@/shared/ui/AddArea';
import { Select } from '@/shared/ui/Select';
import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { useLibrary } from '../model/Library';
import { useNotice } from '@/shared/model/Notice';
import { HoverDeleteButton } from '@/shared/ui/HoverDeleteButton';
import { useLaunch } from '@/features/launch/model/Launch';
import { useStorage } from '@/shared/storage/Storage';
import { cx } from '@/shared/ui';

export function LibraryView() {
  const { isDesktop } = useStorage();
  const { characters, locations, removeAsset, restoreAsset, error, warnings } = useLibrary();
  const { demo } = useNotice();
  const [tab, setTab] = useState('Персонажи');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(characters[0]?.id ?? '');
  const [category, setCategory] = useState('Все');
  const { setDialog } = useLaunch();
  const collection = tab === 'Персонажи' ? characters : locations;
  const categories = [
    ...new Set(collection.map((item) => item.category).filter((value): value is string => !!value)),
  ];
  const activeCategory = categories.includes(category) ? category : 'Все';
  useEffect(() => {
    if (category !== activeCategory) setCategory(activeCategory);
  }, [category, activeCategory]);
  const filtered = collection.filter(
    (item) =>
      item.title.toLowerCase().includes(search.toLowerCase()) &&
      (activeCategory === 'Все' || item.category === activeCategory),
  );
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? collection[0];
  const isCharacter = tab === 'Персонажи';
  return (
    <div className="page-body">
      <div className="library-toolbar">
        <div className="segmented">
          {['Персонажи', 'Локации'].map((label) => (
            <button
              className={cx(tab === label && 'active')}
              key={label}
              onClick={() => {
                setTab(label);
                setSearch('');
                setCategory('Все');
              }}
            >
              {label}
              <small>{label === 'Персонажи' ? characters.length : locations.length}</small>
            </button>
          ))}
        </div>

        {categories.length > 0 && (
          <div className="library-category">
            <Select
              label="Категория библиотеки"
              value={activeCategory}
              onValueChange={setCategory}
              options={[
                { value: 'Все', label: 'Все категории' },
                ...categories.map((value) => ({
                  value,
                  label:
                    (
                      { men: 'Парни', women: 'Девушки', winter: 'Зимние' } as Record<string, string>
                    )[value] ?? value,
                })),
              ]}
            />
          </div>
        )}
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label="Поиск в библиотеке"
            placeholder="Найти…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>
      <div className="asset-strip">
        <AddArea
          className={cx('asset-thumb', 'asset-create-thumb', !isCharacter && 'location-thumb')}
          label={isCharacter ? 'Создать персонажа' : 'Создать локацию'}
          onClick={() =>
            setDialog({
              title: isCharacter ? 'Новый персонаж' : 'Новая локация',
              kind: 'new-asset',
              agentId: isDesktop ? undefined : isCharacter ? 'characters' : 'scenes',
              assetType: isCharacter ? 'characters' : 'scenes',
            })
          }
        />
        {filtered.map((item) => (
          <div
            className={cx('asset-thumb-wrap', !isCharacter && 'location-wrap')}
            key={item.id}
            data-removable
          >
            <button
              className={cx(
                'asset-thumb',
                !isCharacter && 'location-thumb',
                selected.id === item.id && 'active',
              )}
              onClick={() => setSelectedId(item.id)}
            >
              <img src={item.image} alt="" />
              <span>{item.title}</span>
            </button>
            <HoverDeleteButton
              label={`Удалить ${item.title}`}
              onDelete={() => {
                removeAsset(item.id);
                demo(`«${item.title}» убран из библиотеки.`, {
                  label: 'Вернуть',
                  onClick: () => restoreAsset(item.id),
                });
              }}
            />
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {warnings.length > 0 && (
        <p role="alert" className="error-message">
          Не прочитаны материалы: {warnings.join('; ')}
        </p>
      )}
      {filtered.length === 0 ? (
        <p className="no-results">
          {collection.length
            ? 'Ничего не найдено.'
            : isCharacter
              ? 'Персонажей пока нет.'
              : 'Локаций пока нет.'}
        </p>
      ) : (
        <LibraryAssetViewer key={tab} asset={selected} character={isCharacter} />
      )}
    </div>
  );
}
