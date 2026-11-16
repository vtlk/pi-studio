import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
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
  useTranslation(undefined, { i18n });
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
      <h2>{t('MontageCard.montageProject')}</h2>
      <p>{result.ok ? result.name : file.name}</p>
      <p className="prototype-note">{t('MontageCard.exampleDocumentViewOnlyRealPlaybackAnd')}</p>
      {result.ok ? (
        <dl className="data-list">
          <dt>{t('MontageCard.size')}</dt>
          <dd>1080 × 1920</dd>
          <dt>{t('MontageCard.frameRate')}</dt>
          <dd>30 fps</dd>
          <dt>{t('MontageCard.state')}</dt>
          <dd>{t('MontageCard.compatibleWithTheUiPrototype')}</dd>
        </dl>
      ) : (
        <p role="alert" className="error-message">
          {result.error}
        </p>
      )}
      <Button kind="primary" disabled={!result.ok} onClick={() => setOpen(true)}>
        {t('MontageCard.openMontage')}
      </Button>
      <DisclosureList>
        <Disclosure label={t('MontageCard.manifest')}>
          <pre className="output-text output-code">{file.content}</pre>
        </Disclosure>
      </DisclosureList>
    </section>
  );
}
