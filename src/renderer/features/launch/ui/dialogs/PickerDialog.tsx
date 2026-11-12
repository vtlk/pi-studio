import { AddArea } from '@/shared/ui/AddArea';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui';
import { useLibrary } from '@/features/library/model/Library';
import { useLaunch, type Dialog } from '../../model/Launch';
import { useNotice } from '@/shared/model/Notice';
export function PickerDialog({ request }: { request: NonNullable<Dialog> }) {
  const { characters, locations } = useLibrary();
  const { setDialog } = useLaunch();
  const { demo } = useNotice();
  const character = request.assetType === 'characters';
  return (
    <Modal
      title={request.title}
      onClose={() => setDialog(null)}
      footer={<Button onClick={() => setDialog(null)}>Отмена</Button>}
    >
      <div className="picker-grid">
        <AddArea
          className="picker-create"
          label={character ? 'Создать персонажа' : 'Создать локацию'}
          onClick={() =>
            setDialog({
              title: character ? 'Создать персонажа' : 'Создать локацию',
              kind: 'new-asset',
              agentId: character ? 'characters' : 'scenes',
              assetType: character ? 'characters' : 'scenes',
            })
          }
        />
        {(character ? characters : locations).map((item) => (
          <button
            key={item.id}
            onClick={() => {
              setDialog(null);
              demo(`Выбран «${item.title}». Привязка к проекту пока не подключена.`);
            }}
          >
            <img src={item.image} alt="" />
            <span>{item.title}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
