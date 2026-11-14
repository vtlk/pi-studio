import { useState } from 'react';
import { useNotice } from '@/shared/model/Notice';
import { useProject } from '@/features/project/model/projectHooks';
import { Button, EmptyIntegration } from '@/shared/ui';
import { Select } from '@/shared/ui/Select';
import { SectionMenu } from '@/shared/ui/SectionMenu';
import { SetupAssistant } from '@/features/setup-assistant/ui/SetupAssistant';
import { useCoreTools } from '@/features/connections/model/useCoreTools';
import { ConnectionsPanel } from '@/features/connections/ui/ConnectionsPanel';
import { ResourceCatalog } from '@/features/resources/ui/ResourceCatalog';
import type { CapabilityKind } from '@/entities/studio/types';
import { useStorage, useStoredState } from '@/shared/storage/Storage';
import type { PiCheck } from '../../../../shared/contracts';

function LegacyRules() {
  const { baseInstruction, setBaseInstruction } = useProject();
  return (
    <>
      <h2>Общие инструкции</h2>
      <textarea
        aria-label="Общие инструкции проекта"
        value={baseInstruction}
        onChange={(event) => setBaseInstruction(event.target.value)}
      />
      <p>Изменения только в памяти веб-макета.</p>
    </>
  );
}
export function SettingsView() {
  const coreTools = useCoreTools();
  const { demo } = useNotice();
  const [section, setSection] = useState('workspace');
  const { bootstrap, isDesktop, openStudio, chooseStudio, saving } = useStorage();
  const [folder, setFolder] = useState(bootstrap?.folder ?? '');
  const [pi, setPi] = useStoredState('piPath', '');
  const [piCheck, setPiCheck] = useState<PiCheck>();
  const [checking, setChecking] = useState(false);
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
          ...(!isDesktop ? [{ id: 'rules', label: 'Общие инструкции' }] : []),
        ]}
        selected={section}
        onSelect={setSection}
      />
      <section className="settings-content">
        {section === 'workspace' ? (
          <>
            <h2>Рабочее пространство</h2>
            <p>
              {isDesktop
                ? 'Настройки и проекты сохраняются в выбранной папке. Существующая студия открывается при выборе папки.'
                : 'Веб-макет: настройки в памяти.'}
            </p>
            <div className="settings-field-row">
              <label className="field-label">
                Папка студии
                <input
                  placeholder="/Users/…/Pi Studio"
                  value={folder}
                  onChange={(event) => setFolder(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && isDesktop) void openStudio(folder.trim());
                  }}
                />
              </label>
              <Button
                disabled={saving}
                onClick={() =>
                  isDesktop
                    ? void chooseStudio()
                    : demo('Системный выбор папки доступен в приложении macOS.')
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
                disabled={checking}
                onClick={async () => {
                  if (!window.studio) {
                    demo('Проверка Pi доступна в приложении macOS.');
                    return;
                  }
                  setChecking(true);
                  setPiCheck(undefined);
                  try {
                    const result = await window.studio.checkPi(pi);
                    setPiCheck(result);
                    setPi(result.path);
                  } catch (error) {
                    demo(error instanceof Error ? error.message : 'Ошибка проверки Pi.');
                  } finally {
                    setChecking(false);
                  }
                }}
              >
                {checking ? 'Проверяем…' : 'Проверить Pi'}
              </Button>
            </div>
            {piCheck && (
              <p role="status">
                Pi {piCheck.version} ·{' '}
                {piCheck.supported ? 'поддерживаемая версия' : 'версия ещё не проверена со Studio'}{' '}
                · MCP: {piCheck.nativeMcp ? 'встроенный' : 'не найден'} · точные сессии:{' '}
                {piCheck.exactSessions ? 'поддерживаются' : 'не подтверждены'}. Проверка не
                запускает генерацию.
              </p>
            )}
            <p className="section-space">
              Общие инструменты:{' '}
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
          <LegacyRules />
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
