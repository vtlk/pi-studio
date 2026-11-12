import { useState } from 'react';
import { useNotice } from '@/shared/model/Notice';
import { useProject } from '@/features/project/model/Project';
import { Button, EmptyIntegration } from '@/shared/ui';
import { Select } from '@/shared/ui/Select';
import { SectionMenu } from '@/shared/ui/SectionMenu';
import { SetupAssistant } from '@/features/setup-assistant/ui/SetupAssistant';
import { coreTools } from '@/entities/studio/tools';
import { ConnectionsPanel } from '@/features/connections/ui/ConnectionsPanel';
import { ResourceCatalog } from '@/features/resources/ui/ResourceCatalog';
import type { CapabilityKind } from '@/entities/studio/types';

export function SettingsView() {
  const { demo } = useNotice();
  const { baseInstruction, setBaseInstruction } = useProject();
  const [section, setSection] = useState('workspace');
  const [folder, setFolder] = useState('');
  const [pi, setPi] = useState('');
  return (
    <div className="page-body settings-layout">
      <SectionMenu
        label="Настройки студии"
        items={[
          { id: 'workspace', label: 'Рабочее пространство' },
          { id: 'connections', label: 'Подключения' },
          { id: 'assistant', label: 'Помощник подключения' },
          { id: 'skills', label: 'Каталог Skills' },
          { id: 'mcps', label: 'MCP-серверы' },
          { id: 'plugins', label: 'Пакеты Pi' },
          { id: 'rules', label: 'Общие инструкции' },
        ]}
        selected={section}
        onSelect={setSection}
      />
      <section className="settings-content">
        {section === 'workspace' ? (
          <>
            <h2>Рабочее пространство</h2>
            <p>Прототип: настройки в памяти, файлы на диске не создаются.</p>
            <div className="settings-field-row">
              <label className="field-label">
                Папка студии
                <input
                  placeholder="/Users/…/Pi Studio"
                  value={folder}
                  onChange={(event) => setFolder(event.target.value)}
                />
              </label>
              <Button
                onClick={() =>
                  demo(
                    'Системный выбор папки и чтение существующей студии будут подключены после утверждения интерфейса.',
                  )
                }
              >
                Выбрать папку
              </Button>
            </div>
            <label className="field-label">
              Путь к Pi
              <input
                value={pi}
                onChange={(event) => setPi(event.target.value)}
                placeholder="Исполняемый файл Pi"
              />
            </label>
            <div className="settings-field-row">
              <label className="field-label">
                Запуск агента
                <Select
                  label="Запуск агента"
                  options={[
                    'Открыть macOS Terminal',
                    { value: 'rpc', label: 'Внутри приложения · RPC, позже', disabled: true },
                  ]}
                />
              </label>
              <Button
                onClick={() =>
                  demo('Pi не запускался. Проверка исполняемого файла ещё не подключена.')
                }
              >
                Проверить Pi
              </Button>
            </div>
            <p className="section-space">
              Общие инструменты всех агентов:{' '}
              {coreTools.map((tool) => `${tool.name} — ${tool.status.toLowerCase()}`).join(', ')}.
            </p>
            <EmptyIntegration>
              Только macOS. Авторизация провайдеров и секреты — отдельно от файлов проектов.
            </EmptyIntegration>
          </>
        ) : section === 'assistant' ? (
          <SetupAssistant />
        ) : section === 'connections' ? (
          <ConnectionsPanel />
        ) : section === 'rules' ? (
          <>
            <h2>Общие инструкции</h2>
            <textarea
              aria-label="Общие инструкции проекта"
              value={baseInstruction}
              onChange={(event) => setBaseInstruction(event.target.value)}
            />
            <Button kind="primary" onClick={() => demo('Инструкции изменены в памяти прототипа.')}>
              Сохранить в макете
            </Button>
            <p>
              Перед перерисовкой персонажа, анимацией SVG-превью и финальным рендером требуется
              явное одобрение человека.
            </p>
          </>
        ) : (
          <>
            <h2>
              {section === 'skills'
                ? 'Каталог Skills'
                : section === 'mcps'
                  ? 'MCP-серверы'
                  : 'Пакеты и расширения Pi'}
            </h2>
            <p>Общий каталог студии. У каждого агента — собственный набор ресурсов и включение.</p>
            <ResourceCatalog key={section} kind={section as CapabilityKind} />
          </>
        )}
      </section>
    </div>
  );
}
