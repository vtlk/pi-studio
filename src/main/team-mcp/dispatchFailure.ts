import { t } from '../../shared/i18n/index.ts';
/** Only known static app messages cross the tool boundary; never raw extension/provider diagnostics. */
export function teamDispatchFailure(error: unknown) {
  const safe = [
    'error.runHost.thisDialogueIsStillOpen',
    'error.contextBuilder.selectTheAgentSConnection',
    'error.resolveAgentLaunchConfig.theAgentSConnectionIs',
    'error.resolveAgentLaunchConfig.theSelectedModelIsMissing',
    'error.resolveAgentLaunchConfig.signInToTheSelected',
    'error.runHost.theNextAgentDidNotAccept',
    'error.runHost.thisAgentIsAlreadyOpening',
    'error.createStudioRunHost.theAgentProfileWasDeleted',
    'error.dispatch.theRecipientSExactBinding',
    'error.dispatch.theRecipientTeamChangedBefore',
    'Chat.disconnected',
    'Chat.notReady',
    'AgentRefresh.refreshing',
  ] as const;
  const message = error instanceof Error ? error.message : undefined;
  const known = safe.map((key) => t(key)).find((text) => text === message);
  return known ? t('Team.dispatchNotSent', { reason: known }) : t('Team.dispatchUnavailable');
}
