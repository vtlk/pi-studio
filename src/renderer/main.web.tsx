import { i18n } from '../shared/i18n/index.ts';
import webEn from '../shared/i18n/web.en.json';
import webRu from '../shared/i18n/web.ru.json';
import React, { type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import './styles/index.css';
import { initialAgents } from './fixtures/studio';
import { exampleConnections } from './fixtures/connections';
import { exampleResources } from './fixtures/resources';
import { useDemoWorkspaceState } from './features/project/model/useDemoWorkspaceState';
import { ProjectProvider } from './features/project/model/Project';
import { LanguageProvider, initialLanguage } from './shared/model/Language';
import { ThemeProvider, initialTheme } from './shared/model/Theme';

const appearance = initialTheme(false);

function DemoProviders({ children }: { children: ReactNode }) {
  return <ProjectProvider>{children}</ProjectProvider>;
}
function useWorkspaceState() {
  return { ...useDemoWorkspaceState(), trashProjects: [], busy: false };
}

i18n.addResourceBundle('en', 'translation', webEn, true);
i18n.addResourceBundle('ru', 'translation', webRu, true);
const language = await initialLanguage(false);
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LanguageProvider initial={language} native={false}>
      <ThemeProvider initial={appearance} native={false}>
        <App
          useWorkspaceState={useWorkspaceState}
          ExtraProviders={DemoProviders}
          defaults={{
            agents: initialAgents,
            connections: exampleConnections,
            resources: exampleResources,
          }}
        />
      </ThemeProvider>
    </LanguageProvider>
  </React.StrictMode>,
);
