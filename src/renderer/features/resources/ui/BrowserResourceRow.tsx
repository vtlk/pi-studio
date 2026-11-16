import { resourceLabel } from '@/shared/model/localizedResources';
import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { Disclosure } from '@/shared/ui/Disclosure';
import { browserMcp } from '../../../../shared/builtinResources';
import { BrowserResourceStatus } from './BrowserResourceStatus';

export function BrowserResourceRow() {
  useTranslation(undefined, { i18n });
  return (
    <div className="resource-binding" data-builtin-mcp>
      <Disclosure
        label={resourceLabel(browserMcp, 'name')}
        locked={t('CapabilitiesPanel.requiredMcpCannotBeDisabledOrRemoved')}
        reserveActions
      >
        <p>{resourceLabel(browserMcp, 'description')}</p>
        <BrowserResourceStatus />
      </Disclosure>
    </div>
  );
}
