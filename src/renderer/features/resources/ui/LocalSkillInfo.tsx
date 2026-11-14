import { useEffect, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui';
import { Disclosure, DisclosureList } from '@/shared/ui/Disclosure';
import type { SkillDocument } from '../../../../shared/resources';

export function LocalSkillInfo({
  id,
  name,
  onClose,
}: {
  id: string;
  name: string;
  onClose: () => void;
}) {
  const [skill, setSkill] = useState<SkillDocument>();
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    window.studio!.readSkill(id).then(
      (result) => {
        if (active) setSkill(result);
      },
      (error: unknown) => {
        if (active)
          setError(error instanceof Error ? error.message : 'Не удалось прочитать SKILL.md.');
      },
    );
    return () => {
      active = false;
    };
  }, [id]);
  return (
    <Modal
      title={skill?.name ?? name}
      onClose={onClose}
      footer={<Button onClick={onClose}>Закрыть</Button>}
    >
      {error ? (
        <p role="alert" className="error-message">
          {error}
        </p>
      ) : skill ? (
        <>
          <p>{skill.description}</p>
          <dl className="data-list">
            <dt>Папка навыка</dt>
            <dd>{skill.source}</dd>
            <dt>Состояние</dt>
            <dd>Текущий файл · загрузка назначенным агентом при следующем запуске Pi</dd>
          </dl>
          <DisclosureList>
            <Disclosure label="Содержимое SKILL.md">
              <pre className="output-text">{skill.content}</pre>
            </Disclosure>
          </DisclosureList>
          <p className="subtle">
            Текст читается из исходного файла при открытии. Внешний skill здесь доступен только для
            чтения; его скрипты не запускаются.
          </p>
        </>
      ) : (
        <p role="status">Читаем SKILL.md…</p>
      )}
    </Modal>
  );
}
