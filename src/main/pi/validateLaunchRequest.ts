import type { LaunchAgentRequest } from '../../shared/runtime.ts';
export function validateLaunchRequest(request: LaunchAgentRequest) {
  if (typeof request.autoContinue !== 'boolean') throw new Error('Некорректный режим запуска.');
  if (
    request.attachments !== undefined &&
    (!Array.isArray(request.attachments) ||
      request.attachments.length > 32 ||
      request.attachments.some((id) => typeof id !== 'string'))
  )
    throw new Error('Некорректный список референсов.');
  if (request.attachments?.length && !request.firstMessage)
    throw new Error('Референсы отправляются только вместе с первым сообщением нового диалога.');
}
