import { t } from '../../shared/i18n/index.ts';
import type { LaunchAgentRequest } from '../../shared/runtime.ts';
export function validateLaunchRequest(request: LaunchAgentRequest) {
  if (typeof request.autoContinue !== 'boolean')
    throw new Error(t('error.validateLaunchRequest.invalidLaunchMode'));
  if (
    request.attachments !== undefined &&
    (!Array.isArray(request.attachments) ||
      request.attachments.length > 32 ||
      request.attachments.some((id) => typeof id !== 'string'))
  )
    throw new Error(t('error.validateLaunchRequest.invalidReferenceList'));
  if (request.attachments?.length && !request.firstMessage)
    throw new Error(t('error.validateLaunchRequest.referencesAreSentOnlyWith'));
}
