import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { Textarea } from '@/shared/ui/Textarea';
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
  useTranslation(undefined, { i18n });
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
          setError(
            error instanceof Error ? error.message : t('ManagedSkillEditor.couldNotReadTheSkill'),
          );
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
      if (!(await saveNow())) throw new Error(t('ManagedSkillEditor.saveCurrentSettingsFirst'));
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
      setError(
        error instanceof Error ? error.message : t('ManagedSkillEditor.couldNotSaveTheSkill'),
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      title={resource ? t('ManagedSkillEditor.editSkill') : t('ManagedSkillEditor.newSkill')}
      onClose={() => !saving && onClose()}
      footer={
        <>
          <Button disabled={saving} onClick={onClose}>
            {t('TeamNameDialog.cancel')}
          </Button>
          <Button
            kind="primary"
            disabled={loading || saving || !name.trim() || !description.trim() || !content.trim()}
            onClick={() => void save()}
          >
            {saving ? t('Topbar.saving') : t('TeamNameDialog.save')}
          </Button>
        </>
      }
    >
      <label className="field-label">
        {t('ManagedSkillEditor.skillName')}
        <input
          value={name}
          placeholder="create-character"
          disabled={loading || saving}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="field-label">
        {t('ManagedSkillEditor.description')}
        <input
          value={description}
          disabled={loading || saving}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <Textarea
        label={t('AgentProfileEditor.instructions')}
        className="skill-instructions-input"
        value={content}
        disabled={loading || saving}
        onChange={(event) => setContent(event.target.value)}
      />
      <p className="subtle">{t('ManagedSkillEditor.theSharedSkillMdAppliesTheNext')}</p>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
