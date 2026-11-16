import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import './styles/index.css';
import { useNativeWorkspaceState } from './features/project/model/useNativeWorkspaceState';
import { StartupScreen } from './shared/ui/StartupScreen';
import { ThemeProvider, initialTheme } from './shared/model/Theme';

const appearance = initialTheme(true);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider initial={appearance} native>
      {window.studio ? (
        <App useWorkspaceState={useNativeWorkspaceState} />
      ) : (
        <StartupScreen
          error
          message="Нативное подключение Pi Studio недоступно. Перезапустите приложение."
        />
      )}
    </ThemeProvider>
  </React.StrictMode>,
);
