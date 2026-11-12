import { HoverDeleteButton } from '@/shared/ui/HoverDeleteButton';
import { useNotice } from '@/shared/model/Notice';
import { useProject } from '../model/Project';
import { characters, character } from '@/fixtures/studio';
import { useLaunch } from '@/features/launch/model/Launch';
import { Button } from '@/shared/ui';
import { Select } from '@/shared/ui/Select';
export function CastCards({ compact = false }: { compact?: boolean }) {
  const { setDialog } = useLaunch();
  const { demo } = useNotice();
  const { removedCastRoles, removeCastRole, restoreCastRole } = useProject();
  return (
    <div className={compact ? 'cast-list compact' : 'cast-list'}>
      {[
        { role: 'Механик', asset: character, voice: 'Алексей' },
        {
          role: 'Соседка',
          asset: characters.find((item) => item.id === 'winter-02-grandmother'),
          voice: 'Мария',
        },
        { role: 'Рассказчик', asset: undefined, voice: 'Алексей' },
      ]
        .filter((item) => !removedCastRoles.includes(item.role))
        .reverse()
        .map((item) => (
          <div className="cast-row" key={item.role} data-removable>
            {item.asset ? (
              <img src={item.asset.image} alt={item.asset.title} />
            ) : (
              <div className="cast-narrator" />
            )}
            <div className="cast-role">
              <strong>{item.role}</strong>
              {item.asset && <span>{item.asset.title} · v3</span>}
            </div>
            {item.asset && (
              <Button
                onClick={() =>
                  setDialog({
                    title: 'Добавить персонажа',
                    kind: 'picker',
                    assetType: 'characters',
                  })
                }
              >
                Выбрать персонажа
              </Button>
            )}
            <label className="inline-field">
              Голос
              <Select
                label={`Голос: ${item.role}`}
                defaultValue={item.voice}
                options={['Алексей', 'Мария', 'Выбрать…']}
              />
            </label>
            <HoverDeleteButton
              label={`Убрать ${item.role} из проекта`}
              onDelete={() => {
                removeCastRole(item.role);
                demo(`«${item.role}» убран из проекта.`, {
                  label: 'Вернуть',
                  onClick: () => restoreCastRole(item.role),
                });
              }}
            />
          </div>
        ))}
    </div>
  );
}
