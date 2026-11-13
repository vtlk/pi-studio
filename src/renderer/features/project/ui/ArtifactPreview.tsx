import type { ProjectAgent, OutputFile } from '../model/workspace.types';
import { Disclosure, DisclosureList } from '@/shared/ui/Disclosure';
export function ArtifactPreview({ file }: { file: OutputFile; agent: ProjectAgent }) {
  const artifact = file.artifact;
  if (!artifact) return null;
  return (
    <section className="artifact-preview">
      <h2>{artifact.title}</h2>
      <p className="prototype-note">Пример результата агента · просмотр без редактирования файла</p>
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
          <Disclosure label="Версия материала библиотеки" defaultOpen>
            <p>
              {artifact.reference.title} · зафиксирована v{artifact.reference.version}. Доступна v
              {artifact.reference.latestVersion}.
            </p>
            <p>
              Обновление ссылки и создание проектного варианта выполняются агентом после явного
              выбора в диалоге.
            </p>
          </Disclosure>
        )}
        <Disclosure label="Исходный JSON">
          <pre className="output-text output-code">{file.content}</pre>
        </Disclosure>
      </DisclosureList>
    </section>
  );
}
