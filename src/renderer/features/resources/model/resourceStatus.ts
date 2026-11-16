import { t, i18n } from '../../../../shared/i18n/index.ts';
import type { Resource } from '../../../../shared/resources';

export function resourceStatus(resource: Resource, native: boolean) {
  if (!native) return t('resourceStatus.exampleNotConnected');
  if (!resource.check)
    return resource.localSkill
      ? t('resourceStatus.localSkillLoadsAtLaunch')
      : t('resourceStatus.unchecked');
  const labels = {
    available: t('resourceStatus.available'),
    needs_auth: t('resourceStatus.signInRequired'),
    unavailable: t('CapabilitiesPanel.unavailable'),
    disabled: t('resourceStatus.disabledInPi'),
  };
  const date = new Date(resource.check.checkedAt).toLocaleString(i18n.resolvedLanguage, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
  return t('resourceStatus.checked', {
    value1: labels[resource.check.status],
    value2: date,
    value3:
      resource.check.toolCount === undefined
        ? ''
        : t('resourceStatus.tools', { value1: resource.check.toolCount }),
  });
}
