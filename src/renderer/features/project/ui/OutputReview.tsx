import type { OutputFile, ProjectAgent } from '../model/workspace.types';
import { useWorkspace } from '../model/Workspace';
import { Button } from '@/shared/ui';
import { Disclosure } from '@/shared/ui/Disclosure';
import { useStorage } from '@/shared/storage/Storage';
export function OutputReview({ file }: { file: OutputFile; agent: ProjectAgent }) {
  const { selectedProject, reviewFile } = useWorkspace();
  const { isDesktop } = useStorage();
  if (
    isDesktop ||
    !selectedProject ||
    file.name.endsWith('.pistudio.json') ||
    file.format === 'audio' ||
    file.format === 'video' ||
    file.format === 'unsupported'
  )
    return null;
  const review = selectedProject.reviews?.[file.id] ?? { revision: 1, acceptedRevision: null };
  const accepted = review.acceptedRevision === review.revision;
  return (
    <div className="output-review">
      <span>
        v{review.revision} · {accepted ? 'Принята в макете' : 'Не принята'}
      </span>
      <div className="action-row">
        <Button kind="primary" onClick={() => reviewFile(selectedProject.id, file.id, !accepted)}>
          {accepted
            ? 'Отменить принятие'
            : file.name === 'сцена.svg'
              ? 'Принять SVG-превью'
              : 'Принять версию'}
        </Button>
      </div>
      <Disclosure label="Версии и зависимости">
        <p>
          v1 · демонстрационный исходник. Новые версии появятся после выполнения агента. Изменения
          исходных материалов помечают зависимые результаты устаревшими и отменяют их принятие.
        </p>
      </Disclosure>
    </div>
  );
}
