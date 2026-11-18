import { i18n, t } from '../../shared/i18n/index.ts';

/** Snapshot the app language on explicit sign-in; never depend on the browser's locale. */
export function oauthPresentation() {
  return {
    language: i18n.resolvedLanguage === 'ru' ? 'ru' : 'en',
    returnTitle: t('OAuthPage.returnTitle'),
    returnMessage: t('OAuthPage.returnMessage'),
    closePage: t('OAuthPage.closePage'),
    errorTitle: t('OAuthPage.errorTitle'),
    errorMessage: t('OAuthPage.errorMessage'),
    retryMessage: t('OAuthPage.retryMessage'),
    invalidState: t('OAuthPage.invalidState'),
    missingCode: t('OAuthPage.missingCode'),
    alreadyHandled: t('OAuthPage.alreadyHandled'),
    notFound: t('OAuthPage.notFound'),
  };
}
