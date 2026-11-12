import { useState } from 'react';
import { Button, EmptyIntegration } from '@/shared/ui';
import { Modal } from '@/shared/ui/Modal';
import { Select } from '@/shared/ui/Select';
import { useNotice } from '@/shared/model/Notice';
import { useResources, type Resource } from '../model/Resources';
import { LibraryStandardEditor } from './LibraryStandardEditor';
import { libraryStandards, type LibraryStandard } from '../../../../shared/libraryStandards';

export function ResourceEditor({ resource, onClose }: { resource: Resource; onClose: () => void }) {
  const [draft, setDraft] = useState(resource);
  const { saveResource, resources } = useResources();
  const { demo } = useNotice();
  const field = (key: keyof Resource, label: string, placeholder = '') => (
    <label className="field-label">
      {label}
      <input
        value={String(draft[key])}
        placeholder={placeholder}
        onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
      />
    </label>
  );
  const existingSkill =
    resource.kind === 'skills' &&
    resources.some((item) => item.kind === 'skills' && item.id === resource.id);
  const bundled = (Object.keys(libraryStandards) as LibraryStandard[]).find(
    (key) => libraryStandards[key].id === resource.id,
  );
  if (window.studio && resource.kind === 'skills' && bundled)
    return <LibraryStandardEditor skill={bundled} onClose={onClose} />;
  if (existingSkill)
    return (
      <Modal
        title={resource.name}
        onClose={onClose}
        footer={<Button onClick={onClose}>Закрыть</Button>}
      >
        <p>{resource.description}</p>
        <dl className="data-list">
          <dt>Папка навыка</dt>
          <dd>{resource.source || 'Не импортирована'}</dd>
          <dt>Версия</dt>
          <dd>{resource.version || 'Не закреплена'}</dd>
          <dt>Состав</dt>
          <dd>SKILL.md и вспомогательные файлы</dd>
        </dl>
        <p className="subtle">
          Название и описание читаются из SKILL.md. Для других инструкций создаётся отдельный skill.
        </p>
      </Modal>
    );
  return (
    <Modal
      title={resource.name || 'Новый ресурс'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button
            kind="primary"
            disabled={!draft.name.trim()}
            onClick={() => {
              saveResource(draft);
              onClose();
            }}
          >
            Сохранить
          </Button>
        </>
      }
    >
      {field('name', 'Название')}
      <label className="field-label">
        Описание
        <textarea
          value={draft.description}
          onChange={(event) => setDraft({ ...draft, description: event.target.value })}
        />
      </label>
      {draft.kind === 'mcps' ? (
        <>
          <label className="field-label">
            Транспорт
            <Select
              label="Транспорт MCP"
              options={['HTTP', 'stdio']}
              value={draft.transport}
              onValueChange={(transport) => setDraft({ ...draft, transport })}
            />
          </label>
          {field(
            'source',
            draft.transport === 'HTTP' ? 'URL сервера' : 'Исполняемый файл',
            draft.transport === 'HTTP' ? 'https://example.com/mcp' : '/path/to/server',
          )}
          {draft.transport === 'stdio' &&
            field('args', 'Аргументы запуска', 'Отдельный массив аргументов JSON')}
          {field(
            'credential',
            'Ссылка на учётные данные',
            'Например: keychain:heygen — без токена',
          )}
          <div className="action-row">
            <Button
              onClick={() =>
                demo(
                  'Авторизация MCP не выполнялась. В рабочей версии откроется вход в выбранный сервис.',
                )
              }
            >
              Авторизовать
            </Button>
            <Button
              onClick={() => demo('Проверка подключения не выполнялась. MCP пока не подключён.')}
            >
              Проверить подключение
            </Button>
          </div>
          <p className="subtle">
            Статус: не подключён. Секреты хранятся отдельно от профилей и проектов; в макете секреты
            не вводятся.
          </p>
        </>
      ) : (
        <>
          {field(
            'source',
            draft.kind === 'skills'
              ? 'Папка навыка / SKILL.md'
              : 'Источник пакета npm / git / локальная папка',
          )}
          {draft.kind === 'plugins' && field('version', 'Закреплённая версия')}
          {draft.kind === 'plugins' && (
            <label className="field-label">
              Состав пакета
              <textarea
                value={draft.contents}
                onChange={(event) => setDraft({ ...draft, contents: event.target.value })}
              />
            </label>
          )}
          <Button
            onClick={() =>
              demo(
                draft.kind === 'skills'
                  ? 'Импорт файлов пока не подключён. Путь сохраняется только как настройка макета.'
                  : 'Установка пакетов пока не подключена. Источник и версия сохраняются только в макете.',
              )
            }
          >
            {draft.kind === 'skills' ? 'Импортировать из папки' : 'Установить пакет'}
          </Button>
          <p className="subtle">Статус: не установлен.</p>
        </>
      )}
      <EmptyIntegration>
        Сохранение настроек не устанавливает ресурс и не подключается к сервису.
      </EmptyIntegration>
    </Modal>
  );
}
