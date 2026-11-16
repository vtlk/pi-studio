import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import type { ProjectAgent, OutputFile } from '../model/workspace.types';
import { Disclosure, DisclosureList } from '@/shared/ui/Disclosure';
export function ArtifactPreview({ file }: { file: OutputFile; agent: ProjectAgent }) {
  useTranslation(undefined, { i18n });
  const artifact = file.artifact;
  if (!artifact) return null;
  return (
    <section className="artifact-preview">
      <h2>{artifact.title}</h2>
      <p className="prototype-note">{t('ArtifactPreview.exampleAgentResultFileViewingOnly')}</p>
      <dl className="data-list">
        {artifact.fields.map(([label, value], index) => (
          <div className="data-pair" key={`${label}:${index}`}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <DisclosureList>
        {artifact.reference && (
          <Disclosure label={t('ArtifactPreview.linkedAsset')} defaultOpen>
            <p>
              {artifact.reference.title} {t('ArtifactPreview.pinnedV')}
              {artifact.reference.version}
              {t('ArtifactPreview.availableV')}
              {artifact.reference.latestVersion}.
            </p>
            <p>{t('ArtifactPreview.theAgentUpdatesReferencesAndCreatesA')}</p>
          </Disclosure>
        )}
        <Disclosure label={t('ArtifactPreview.sourceJson')}>
          <pre className="output-text output-code">{file.content}</pre>
        </Disclosure>
      </DisclosureList>
    </section>
  );
}
