import { Button } from '@/shared/ui';
import { PrototypeButton } from '@/features/agents/ui/PrototypeButton';
import { useNotice } from '@/shared/model/Notice';
import { useProject } from '../../model/Project';

export function ScriptStage() {
  const { demo } = useNotice();
  const { setStep, script, setScript, invalidate } = useProject();
  return (
    <div className="stage-page script-workspace">
      <label className="field-label script-idea-label">
        Идея
        <textarea
          aria-label="Идея мультфильма"
          className="idea-input"
          defaultValue="Механик находит во дворе странную посылку. Внутри кто-то стучит. Соседка уверяет, что открывать её — плохая идея."
          placeholder="Опишите идею мультфильма…"
        />
      </label>
      <div className="script-generation-controls">
        <PrototypeButton title="Написать сценарий" agentId="writer" />
      </div>
      {script.length > 0 && (
        <label className="field-label scenario-label">
          Сценарий
          <textarea
            className="script-editor"
            aria-label="Текст сценария"
            value={script}
            onChange={(event) => {
              setScript(event.target.value);
              invalidate();
            }}
          />
        </label>
      )}
      {script.length > 0 && (
        <div className="script-actions">
          <Button
            kind="primary"
            onClick={() => {
              setStep(1);
              demo('Открыт пример плана. Анализ сценария пока не подключён.');
            }}
          >
            Принять сценарий и перейти к плану
          </Button>
        </div>
      )}
    </div>
  );
}
