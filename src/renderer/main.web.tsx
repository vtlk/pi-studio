import React, { type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import './styles/index.css';
import { initialAgents } from './fixtures/studio';
import { exampleConnections } from './fixtures/connections';
import { exampleResources } from './fixtures/resources';
import { useDemoWorkspaceState } from './features/project/model/useDemoWorkspaceState';
import { ProjectProvider } from './features/project/model/Project';
import { PlaybackProvider } from './features/preview/model/Playback';
import { EditorProvider } from './features/editor/model/Editor';
import { ThemeProvider, initialTheme } from './shared/model/Theme';

const appearance = initialTheme(false);

function DemoProviders({ children }: { children: ReactNode }) {
  return (
    <EditorProvider>
      <ProjectProvider>
        <PlaybackProvider>{children}</PlaybackProvider>
      </ProjectProvider>
    </EditorProvider>
  );
}
function useWorkspaceState() {
  return { ...useDemoWorkspaceState(), trashProjects: [], busy: false };
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
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
  </React.StrictMode>,
);
