import { useState } from 'react';
import type { OutputFile, ProjectAgent } from '@/features/project/model/workspace.types';
import { inspectManifest } from '../model/manifest';
import { Button } from '@/shared/ui';
import { Disclosure, DisclosureList } from '@/shared/ui/Disclosure';
import { EditorPrototype } from './EditorPrototype';
export function MontageCard({
  file,
  agent,
  projectId,
  path,
}: {
  file: OutputFile;
  agent: ProjectAgent;
  projectId: string;
  path: string[];
}) {
  const [open, setOpen] = useState(false);
  const result = inspectManifest(file, agent.entries);
  if (open && result.ok)
    return (
      <EditorPrototype
        documentKey={`${projectId}:${agent.profile.id}:${path.join('/')}`}
        initial={result.timeline}
        name={result.name}
        onClose={() => setOpen(false)}
      />
    );
  return (
    <section className="montage-card">
      <h2>Монтажный проект</h2>
      <p>{result.ok ? result.name : file.name}</p>
      <p className="prototype-note">
        Пример документа · просмотр без ручных правок; реальный плеер и рендер не подключены
      </p>
      {result.ok ? (
        <dl className="data-list">
          <dt>Размер</dt>
          <dd>1080 × 1920</dd>
          <dt>Частота</dt>
          <dd>30 fps</dd>
          <dt>Состояние</dt>
          <dd>Совместимо с макетом интерфейса</dd>
        </dl>
      ) : (
        <p role="alert" className="error-message">
          {result.error}
        </p>
      )}
      <Button kind="primary" disabled={!result.ok} onClick={() => setOpen(true)}>
        Открыть монтаж
      </Button>
      <DisclosureList>
        <Disclosure label="Манифест">
          <pre className="output-text output-code">{file.content}</pre>
        </Disclosure>
      </DisclosureList>
    </section>
  );
}
