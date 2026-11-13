import { useState } from 'react';
import { Button, EmptyIntegration } from '@/shared/ui';
import { Modal } from '@/shared/ui/Modal';
import { Select } from '@/shared/ui/Select';
import { useNotice } from '@/shared/model/Notice';
import { useResources, type Resource } from '../model/Resources';
import { LocalSkillInfo } from './LocalSkillInfo';

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
  if (window.studio && resource.kind === 'skills' && resource.localSkill)
    return <LocalSkillInfo id={resource.id} name={resource.name} onClose={onClose} />;
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
              saveResource({
                ...draft,
                check:
                  draft.source === resource.source &&
                  draft.args === resource.args &&
                  draft.credential === resource.credential
                    ? resource.check
                    : undefined,
              });
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
          {!window.studio &&
            field(
              'credential',
              'Ссылка на учётные данные',
              'Например: keychain:heygen — без токена',
            )}
          {!window.studio && (
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
          )}
          <p className="subtle">
            {window.studio
              ? 'Для OAuth и других способов авторизации подключите сервер через помощника как ресурс Pi. После сохранения проверка и вход доступны в каталоге.'
              : 'Пример: MCP не подключён, секреты не вводятся.'}
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
          {draft.kind === 'plugins' && !window.studio && field('version', 'Закреплённая версия')}
          {draft.kind === 'plugins' && window.studio && (
            <p className="subtle">
              Установленная версия: {resource.version || 'Не определена'}. Версия пакета задаётся в
              источнике, например npm:package@1.2.3.
            </p>
          )}
          {draft.kind === 'plugins' && (
            <label className="field-label">
              Состав пакета
              <textarea
                value={draft.contents}
                onChange={(event) => setDraft({ ...draft, contents: event.target.value })}
              />
            </label>
          )}
          {!window.studio && (
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
          )}
          <p className="subtle">
            {window.studio
              ? 'После сохранения пакет можно установить и проверить в каталоге.'
              : 'Пример: не установлен.'}
          </p>
        </>
      )}
      <EmptyIntegration>
        Сохранение настроек не устанавливает ресурс и не подключается к сервису.
      </EmptyIntegration>
    </Modal>
  );
}
