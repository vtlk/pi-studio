import { SectionMenu } from '@/shared/ui/SectionMenu';
import { useState } from 'react';
import { Check } from 'lucide-react';
import { AddArea } from '@/shared/ui/AddArea';
import { useProject } from '../model/Project';
import { useNotice } from '@/shared/model/Notice';
import { useLaunch } from '@/features/launch/model/Launch';
import { locations } from '@/fixtures/studio';
import { Button } from '@/shared/ui';
import { Disclosure } from '@/shared/ui/Disclosure';
import { Select } from '@/shared/ui/Select';
import { Preview } from '@/features/preview/ui/Preview';
import { Timeline } from '@/features/preview/ui/Timeline';

export function ScenesView() {
  const {
    visibleScenes,
    removeScene,
    restoreScene,
    scene,
    setScene,
    currentScene,
    selectedLocation,
    chooseLocation,
    sceneApproved,
    setSceneApproved,
  } = useProject();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const { demo } = useNotice();
  const { openRun, setDialog } = useLaunch();
  if (!visibleScenes.length)
    return (
      <div className="scene-page">
        <AddArea
          label="Добавить сцену"
          onClick={() => demo('Добавление сцен пока не подключено.')}
        />
      </div>
    );
  return (
    <div className="scene-page">
      <div className="scene-section-layout">
        <SectionMenu
          label="Сцены мультфильма"
          leading={
            <AddArea
              label="Добавить сцену"
              onClick={() => demo('Добавление сцен пока не подключено.')}
            />
          }
          selected={scene}
          onSelect={setScene}
          items={visibleScenes
            .map((item, position) => ({
              onRemove: () => {
                removeScene(item.index);
                demo(`Сцена «${item.name}» убрана из проекта.`, {
                  label: 'Вернуть',
                  onClick: () => restoreScene(item.index),
                });
              },
              id: item.index,
              label: `${position + 1}. ${item.name}`,
              suffix: sceneApproved.includes(item.index) ? <Check size={13} /> : undefined,
            }))
            .reverse()}
        />
        <div className="scene-section-body">
          <div className="scene-choices">
            <label>
              Локация
              <Select
                label="Локация сцены"
                value={selectedLocation.id}
                onValueChange={chooseLocation}
                options={locations.map((item) => ({ value: item.id, label: item.title }))}
              />
            </label>
            <AddArea
              label="Создать локацию"
              className="compact-add-area"
              onClick={() => openRun('Создать локацию', currentScene.description, 'scenes')}
            />
            <span className="choice-divider" />
            <label>
              Персонажи
              <Button
                onClick={() =>
                  setDialog({ title: 'Выбрать персонажа', kind: 'picker', assetType: 'characters' })
                }
              >
                Механик · v3
              </Button>
            </label>
            <span className="scene-duration">{currentScene.duration} с</span>
          </div>
          <div className="simple-scene-layout">
            <div>
              <Preview />
              <div className="scene-acceptance">
                <Button
                  onClick={() => {
                    setSceneApproved((items) =>
                      items.includes(scene) ? items : [...items, scene],
                    );
                    demo('Сцена принята в макете.');
                  }}
                >
                  <Check size={14} />
                  {sceneApproved.includes(scene) ? 'Сцена принята' : 'Принять сцену'}
                </Button>
              </div>
              <Disclosure label="Слои и монтажная область">
                <Timeline />
              </Disclosure>
              <div className="simple-prompt">
                <textarea
                  aria-label="Правка сцены"
                  placeholder="Что изменить в сцене?"
                  value={drafts[currentScene.id] ?? ''}
                  onChange={(event) =>
                    setDrafts((previous) => ({
                      ...previous,
                      [currentScene.id]: event.target.value,
                    }))
                  }
                />
                <Button
                  kind="primary"
                  onClick={() =>
                    openRun(
                      'Изменить сцену',
                      drafts[currentScene.id] || currentScene.description,
                      'scenes',
                    )
                  }
                >
                  Изменить с Pi
                </Button>
              </div>
            </div>
            <div className="scene-notes">
              <p>{currentScene.description}</p>
              <p>Механик: «{currentScene.line}»</p>
              <button
                className="text-button"
                onClick={() => openRun('Обогатить сцену', currentScene.description, 'scenes')}
              >
                Обогатить сцену
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
