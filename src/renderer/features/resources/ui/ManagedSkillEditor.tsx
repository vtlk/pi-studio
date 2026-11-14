import { useEffect, useState } from 'react';
import { Button } from '@/shared/ui';
import { Modal } from '@/shared/ui/Modal';
import { useStorage } from '@/shared/storage/Storage';
import { useResources, type Resource } from '../model/Resources';

export function ManagedSkillEditor({
  resource,
  onClose,
}: {
  resource?: Resource;
  onClose: () => void;
}) {
  const { bootstrap, saveNow } = useStorage();
  const { saveResource } = useResources();
  const [name, setName] = useState(resource?.name ?? '');
  const [description, setDescription] = useState(resource?.description ?? '');
  const [content, setContent] = useState('');
  const [previousContent, setPreviousContent] = useState<string>();
  const [loading, setLoading] = useState(!!resource);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!resource || !window.studio) return;
    let active = true;
    window.studio.readSkill(resource.id).then(
      (skill) => {
        if (!active) return;
        setName(skill.name);
        setDescription(skill.description);
        setContent(
          skill.content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').replace(/^\n/, ''),
        );
        setPreviousContent(skill.content);
        setLoading(false);
      },
      (error: unknown) => {
        if (active)
          setError(error instanceof Error ? error.message : 'Не удалось прочитать навык.');
      },
    );
    return () => {
      active = false;
    };
  }, [resource]);
  const save = async () => {
    if (!window.studio || !bootstrap) return;
    setSaving(true);
    setError('');
    try {
      if (!(await saveNow())) throw new Error('Сначала сохраните текущие настройки.');
      const result = await window.studio.saveSkill({
        folder: bootstrap.folder,
        id: resource?.id,
        name,
        description,
        content,
        previousContent,
      });
      saveResource(result);
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось сохранить навык.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      title={resource ? 'Редактировать навык' : 'Новый навык'}
      onClose={() => !saving && onClose()}
      footer={
        <>
          <Button disabled={saving} onClick={onClose}>
            Отмена
          </Button>
          <Button
            kind="primary"
            disabled={loading || saving || !name.trim() || !description.trim() || !content.trim()}
            onClick={() => void save()}
          >
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </Button>
        </>
      }
    >
      <label className="field-label">
        Имя навыка
        <input
          value={name}
          placeholder="create-character"
          disabled={loading || saving}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="field-label">
        Описание
        <input
          value={description}
          disabled={loading || saving}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <label className="field-label">
        Инструкции
        <textarea
          className="skill-instructions-input"
          value={content}
          disabled={loading || saving}
          onChange={(event) => setContent(event.target.value)}
        />
      </label>
      <p className="subtle">
        Общий SKILL.md применяется при следующем запуске назначенных агентов.
      </p>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
