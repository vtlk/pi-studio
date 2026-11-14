import React, { type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import './styles/index.css';
import { initialAgents, characters, locations } from './fixtures/studio';
import { exampleConnections } from './fixtures/connections';
import { exampleResources } from './fixtures/resources';
import { loadCharacterRuntime } from './fixtures/loadCharacterRuntime';
import { useDemoWorkspaceState } from './features/project/model/useDemoWorkspaceState';
import { ProjectProvider } from './features/project/model/Project';
import { PlaybackProvider } from './features/preview/model/Playback';
import { EditorProvider } from './features/editor/model/Editor';

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
    <App
      useWorkspaceState={useWorkspaceState}
      loadCharacter={loadCharacterRuntime}
      ExtraProviders={DemoProviders}
      defaults={{
        agents: initialAgents,
        connections: exampleConnections,
        resources: exampleResources,
        library: { characters, locations },
      }}
    />
  </React.StrictMode>,
);
