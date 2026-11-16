import { t, i18n, type MessageKey } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { getStudioApi } from '@/shared/desktopApi';
import { Button } from '@/shared/ui';
import { browserMcp } from '../../../../shared/builtinResources';

export function BrowserResourceStatus() {
  useTranslation(undefined, { i18n });
  const [busy, setBusy] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [visible, setVisible] = useState(false);
  const [visibleSupported, setVisibleSupported] = useState(false);
  const [message, setMessage] = useState<MessageKey>('BrowserResourceStatus.checkingComponents');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!window.studio) return;
    let active = true;
    void getStudioApi()
      .getBrowserState()
      .then((state) => {
        if (!active) return;
        setInstalled(state.headlessInstalled);
        setVisible(state.headedInstalled);
        setVisibleSupported(state.headedSupported);
        setMessage(
          state.headlessInstalled
            ? 'BrowserResourceStatus.componentsInstalled'
            : 'BrowserResourceStatus.componentsAreNotInstalledYet',
        );
      })
      .catch((error: unknown) => {
        if (!active) return;
        setMessage('BrowserResourceStatus.couldNotCheckComponents');
        setError(error instanceof Error ? error.message : '');
      });
    return () => {
      active = false;
    };
  }, []);
  const install = async (headed = false) => {
    setBusy(true);
    setError('');
    setMessage(
      headed
        ? 'BrowserResourceStatus.downloadingVisibleBrowser'
        : 'BrowserResourceStatus.downloadingAgentBrowserAndChromium',
    );
    try {
      if (headed) {
        const state = await getStudioApi().installVisibleBrowser();
        setVisible(state.headedInstalled);
        setMessage('BrowserResourceStatus.visibleBrowserInstalledAskTheAgentTo');
      } else {
        await getStudioApi().installResource(browserMcp.id);
        setInstalled(true);
        setMessage('BrowserResourceStatus.componentsInstalledTheBrowserOpensWhenAn');
      }
    } catch (error) {
      setMessage('BrowserResourceStatus.couldNotInstallComponents');
      setError(error instanceof Error ? error.message : '');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="resource-native-actions">
      <p className="subtle" role="status">
        {error || t(message)}
      </p>
      {visibleSupported && (
        <>
          <p className="subtle">
            {t('BrowserResourceStatus.visibleBrowser')}
            {visible
              ? t('BrowserResourceStatus.installed')
              : t('BrowserResourceStatus.notInstalled')}
            {t('BrowserResourceStatus.theBrowserRunsWithoutAWindowBy')}
          </p>
          {!visible && (
            <Button
              disabled={busy}
              onClick={() => {
                void install(true);
              }}
            >
              {t('BrowserResourceStatus.installVisibleBrowser')}
            </Button>
          )}
        </>
      )}
      {!installed && window.studio && (
        <Button
          kind="primary"
          disabled={busy}
          onClick={() => {
            void install();
          }}
        >
          {busy
            ? t('BrowserResourceStatus.installing')
            : t('BrowserResourceStatus.installBrowserComponents')}
        </Button>
      )}
    </div>
  );
}
