import { useEffect, useState } from 'react';
import { Button } from '@/shared/ui';
import { Modal } from '@/shared/ui/Modal';
import { SectionMenu } from '@/shared/ui/SectionMenu';
import { useConfirm } from '@/shared/model/Confirm';
import {
  libraryStandards,
  type LibraryStandard,
  type StandardDocument,
  type StandardFile,
} from '../../../../shared/libraryStandards';

export function LibraryStandardEditor({
  skill,
  onClose,
}: {
  skill: LibraryStandard;
  onClose: () => void;
}) {
  const { confirm } = useConfirm();
  const [file, setFile] = useState<StandardFile>('SKILL.md');
  const [document, setDocument] = useState<StandardDocument>();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dirty = document !== undefined && draft !== document.content;
  const report = (error: unknown) =>
    setError(
      error instanceof Error ? error.message : 'Не удалось прочитать или сохранить стандарт.',
    );
  useEffect(() => {
    let active = true;
    window.studio!.readStandard(skill, file).then(
      (result) => {
        if (active) {
          setDocument(result);
          setDraft(result.content);
        }
      },
      (error: unknown) => {
        if (active) report(error);
      },
    );
    return () => {
      active = false;
    };
  }, [skill, file]);
  const discard = (action: () => void) => {
    if (busy) return;
    if (dirty)
      confirm({
        title: 'Отменить несохранённые изменения?',
        description: 'Изменения текущего текста будут потеряны.',
        confirmLabel: 'Отменить изменения',
        onConfirm: action,
      });
    else action();
  };
  const save = async (reset = false) => {
    setBusy(true);
    setError('');
    try {
      const result = reset
        ? await window.studio!.resetStandard(skill, file)
        : await window.studio!.saveStandard(skill, file, draft);
      setDocument(result);
      setDraft(result.content);
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={libraryStandards[skill].name}
      onClose={() => discard(onClose)}
      footer={
        <>
          <Button
            disabled={busy || !document}
            onClick={() =>
              confirm({
                title: 'Сбросить стандарт?',
                description: `Текущий ${file} будет заменён поставляемым текстом. Истории версий нет.`,
                confirmLabel: 'Сбросить',
                onConfirm: () => void save(true),
              })
            }
          >
            Сбросить к исходному
          </Button>
          <Button disabled={busy} onClick={() => discard(onClose)}>
            Закрыть
          </Button>
          <Button
            kind="primary"
            disabled={busy || !dirty || !draft.trim()}
            onClick={() => void save()}
          >
            Сохранить
          </Button>
        </>
      }
    >
      <p>
        Только текущий текст. Следующий явный запуск использует сохранённый стандарт; существующие
        проекты и диалоги не изменяются.
      </p>
      <SectionMenu
        label="Файлы стандарта"
        items={[
          { id: 'SKILL.md', label: 'SKILL.md' },
          { id: 'references/standard.md', label: 'Полный стандарт' },
        ]}
        selected={file}
        onSelect={(next) =>
          discard(() => {
            setDocument(undefined);
            setError('');
            setFile(next as StandardFile);
          })
        }
      />
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {document ? (
        <label className="field-label">
          {file}
          <textarea
            className="standard-editor-text"
            aria-label={`Текст ${file}`}
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
      ) : (
        !error && <p role="status">Читаем стандарт…</p>
      )}
      <p className="subtle">
        Файлы установлены. Инструменты library.* и подключение этого пакета к рабочей Pi-сессии ещё
        не реализованы.
      </p>
    </Modal>
  );
}
