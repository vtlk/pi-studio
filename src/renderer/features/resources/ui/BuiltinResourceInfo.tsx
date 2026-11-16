import { resourceLabel } from '@/shared/model/localizedResources';
import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import type { Resource } from '../../../../shared/resources';
import { Button } from '@/shared/ui';
import { Modal } from '@/shared/ui/Modal';
import { BrowserResourceStatus } from './BrowserResourceStatus';
import { ComputerResourceStatus } from './ComputerResourceStatus';

export function BuiltinResourceInfo({
  resource,
  onClose,
}: {
  resource: Resource;
  onClose: () => void;
}) {
  useTranslation(undefined, { i18n });
  return (
    <Modal
      title={resourceLabel(resource, 'name')}
      onClose={onClose}
      footer={<Button onClick={onClose}>{t('TeamTransfers.close')}</Button>}
    >
      <p>{resourceLabel(resource, 'description')}</p>
      <p>{t('BuiltinResourceInfo.includedWithPiStudioBuiltInResources')}</p>
      {resource.source === 'builtin:browser' && <BrowserResourceStatus />}
      {resource.source === 'builtin:computer' && <ComputerResourceStatus />}
    </Modal>
  );
}
