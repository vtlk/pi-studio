import { uiText, textOf, type UiText } from '@/shared/model/UiText';
import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { getStudioApi } from '@/shared/desktopApi';
import { Button } from '@/shared/ui';
import { browserMcp } from '../../../../shared/builtinResources';

export function BrowserResourceStatus() {
  useTranslation(undefined, { i18n });
  const [busy, setBusy] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [message, setMessage] = useState<UiText>(
    uiText('BrowserResourceStatus.checkingComponents'),
  );
  useEffect(() => {
    if (!window.studio) return;
    let active = true;
    void getStudioApi()
      .checkResource(browserMcp.id)
      .then((check) => {
        if (!active) return;
        setInstalled(check.status === 'available');
        setMessage(
          check.status === 'available'
            ? uiText('BrowserResourceStatus.componentsInstalled')
            : uiText('BrowserResourceStatus.componentsAreNotInstalledYet'),
        );
      })
      .catch((error: unknown) => {
        if (active)
          setMessage(
            error instanceof Error
              ? error.message
              : uiText('BrowserResourceStatus.couldNotCheckComponents'),
          );
      });
    return () => {
      active = false;
    };
  }, []);
  const install = async () => {
    setBusy(true);
    setMessage(uiText('BrowserResourceStatus.downloadingAgentBrowserAndChromium'));
    try {
      await getStudioApi().installResource(browserMcp.id);
      setInstalled(true);
      setMessage(uiText('BrowserResourceStatus.componentsInstalledTheBrowserOpensWhenAn'));
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : uiText('BrowserResourceStatus.couldNotInstallComponents'),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="resource-native-actions">
      <p className="subtle" role="status">
        {textOf(message)}
      </p>
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
