import { t } from '../shared/i18n/index.ts';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import './styles/index.css';
import { useNativeWorkspaceState } from './features/project/model/useNativeWorkspaceState';
import { StartupScreen } from './shared/ui/StartupScreen';
import { LanguageProvider, initialLanguage } from './shared/model/Language';
import { ThemeProvider, initialTheme } from './shared/model/Theme';

const appearance = initialTheme(true);

const root = createRoot(document.getElementById('root')!);
async function start() {
  try {
    const language = await initialLanguage(true);
    root.render(
      <React.StrictMode>
        <LanguageProvider initial={language} native>
          <ThemeProvider initial={appearance} native>
            <App useWorkspaceState={useNativeWorkspaceState} />
          </ThemeProvider>
        </LanguageProvider>
      </React.StrictMode>,
    );
  } catch {
    root.render(
      <StartupScreen error message={t('main.theNativePiStudioConnectionIsUnavailable')} />,
    );
  }
}
void start();
