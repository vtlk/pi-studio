import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { Disclosure } from '@/shared/ui/Disclosure';
import { computerMcp } from '../../../../shared/builtinResources';
import { ComputerResourceStatus } from './ComputerResourceStatus';

export function ComputerResourceRow() {
  useTranslation(undefined, { i18n });
  return (
    <div className="resource-binding" data-builtin-mcp>
      <Disclosure
        label={computerMcp.name}
        locked={t('CapabilitiesPanel.requiredMcpCannotBeDisabledOrRemoved')}
        reserveActions
      >
        <p>{computerMcp.description}</p>
        <ComputerResourceStatus />
      </Disclosure>
    </div>
  );
}
