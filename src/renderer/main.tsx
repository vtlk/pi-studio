import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import './styles/index.css';
import { useNativeWorkspaceState } from './features/project/model/useNativeWorkspaceState';
import { StartupScreen } from './shared/ui/StartupScreen';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {window.studio ? (
      <App useWorkspaceState={useNativeWorkspaceState} />
    ) : (
      <StartupScreen
        error
        message="Нативное подключение Pi Studio недоступно. Перезапустите приложение."
      />
    )}
  </React.StrictMode>,
);
