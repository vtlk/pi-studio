import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { getStudioApi } from '@/shared/desktopApi';
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
  useTranslation(undefined, { i18n });
  const [skill, setSkill] = useState<SkillDocument>();
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    getStudioApi()
      .readSkill(id)
      .then(
        (result) => {
          if (active) setSkill(result);
        },
        (error: unknown) => {
          if (active)
            setError(
              error instanceof Error ? error.message : t('LocalSkillInfo.couldNotReadSkillMd'),
            );
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
      footer={<Button onClick={onClose}>{t('TeamTransfers.close')}</Button>}
    >
      {error ? (
        <p role="alert" className="error-message">
          {error}
        </p>
      ) : skill ? (
        <>
          <p>{skill.description}</p>
          <dl className="data-list">
            <dt>{t('LocalSkillInfo.skillFolder')}</dt>
            <dd>{skill.source}</dd>
            <dt>{t('LocalSkillInfo.state')}</dt>
            <dd>{t('LocalSkillInfo.currentFileAssignedAgentsLoadItThe')}</dd>
          </dl>
          <DisclosureList>
            <Disclosure label={t('LocalSkillInfo.skillMdContents')}>
              <pre className="output-text">{skill.content}</pre>
            </Disclosure>
          </DisclosureList>
          <p className="subtle">{t('LocalSkillInfo.theSourceFileIsReadWhenOpened')}</p>
        </>
      ) : (
        <p role="status">{t('LocalSkillInfo.readingSkillMd')}</p>
      )}
    </Modal>
  );
}
