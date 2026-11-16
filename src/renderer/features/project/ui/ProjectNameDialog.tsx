import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import type { WorkspaceProject } from '../model/workspace.types';
import { useWorkspace } from '../model/Workspace';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui';
import { useNotice } from '@/shared/model/Notice';
import { useStorage } from '@/shared/storage/Storage';

export function ProjectNameDialog({
  project,
  mode,
  onClose,
}: {
  project: WorkspaceProject;
  mode: 'clone' | 'rename';
  onClose: () => void;
}) {
  useTranslation(undefined, { i18n });
  const [name, setName] = useState(
    mode === 'clone' ? t('ProjectNameDialog.copy', { value1: project.name }) : project.name,
  );
  const { cloneProject, renameProject, busy } = useWorkspace();
  const { isDesktop } = useStorage();
  const { demo } = useNotice();
  return (
    <Modal
      title={
        mode === 'clone'
          ? t('ProjectNameDialog.cloneProject')
          : t('ProjectNameDialog.renameProject')
      }
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            {t('TeamNameDialog.cancel')}
          </Button>
          <Button
            kind="primary"
            disabled={busy || !name.trim() || /[/\\]/.test(name)}
            onClick={async () => {
              const result =
                mode === 'clone'
                  ? await cloneProject(project, name)
                  : await renameProject(project.id, name);
              if (result === false) return;
              demo(
                isDesktop
                  ? mode === 'clone'
                    ? t('ProjectNameDialog.theProjectAndAllItsFilesWere')
                    : t('ProjectNameDialog.projectNameAndFolderChanged')
                  : mode === 'clone'
                    ? t('ProjectNameDialog.anIndependentCopyOfTheSnapshotAnd')
                    : t('ProjectNameDialog.theNameAndExamplePathChangedIn'),
              );
              onClose();
            }}
          >
            {mode === 'clone' ? t('ProjectNameDialog.clone') : t('ProjectNameDialog.rename')}
          </Button>
        </>
      }
    >
      <label className="field-label">
        {t('NewProjectDialog.projectName')}
        <input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <p>
        {mode === 'clone'
          ? t('ProjectNameDialog.theCopyGetsANewIdAnd')
          : t('ProjectNameDialog.projectIdAgentIdsAndRelativeOutput')}
      </p>
      {isDesktop && mode === 'rename' && (
        <p className="subtle">{t('ProjectNameDialog.thisProjectSOpenPiDialoguesWill')}</p>
      )}
      {!isDesktop && (
        <p className="subtle">{t('ProjectNameDialog.theOperationUsesWebPrototypeData')}</p>
      )}
    </Modal>
  );
}
