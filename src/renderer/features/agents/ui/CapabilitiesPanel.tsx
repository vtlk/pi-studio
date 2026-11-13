import { useState } from 'react';
import { AddArea } from '@/shared/ui/AddArea';
import { Switch } from '@/shared/ui/SelectionControls';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui';
import { HoverDeleteButton } from '@/shared/ui/HoverDeleteButton';
import { Disclosure } from '@/shared/ui/Disclosure';
import { useNotice } from '@/shared/model/Notice';
import { useResources } from '@/features/resources/model/Resources';
import { ResourceCatalog } from '@/features/resources/ui/ResourceCatalog';
import { useAgentProfiles } from '../model/AgentProfiles';
import { resourceStatus } from '@/features/resources/model/resourceStatus';
import { systemAgentDefinitions } from '../../../../shared/systemAgents';
import { LockKeyhole } from 'lucide-react';

export function CapabilitiesPanel() {
  const { agentTab, selectedAgent, selectedSystemRole, updateAgent } = useAgentProfiles();
  const { resources } = useResources();
  const { demo } = useNotice();
  const [catalog, setCatalog] = useState(false);
  if (!selectedAgent) return null;
  const field = agentTab === 'Skills' ? 'skills' : agentTab === 'MCP' ? 'mcps' : 'plugins';
  return (
    <div className="agent-settings-content">
      {field === 'mcps' && (
        <div className="resource-binding" data-builtin-mcp>
          <Disclosure
            label={
              selectedSystemRole
                ? systemAgentDefinitions[selectedSystemRole].mcp
                : 'Pi Studio · Проект'
            }
            leading={<LockKeyhole size={16} aria-hidden="true" />}
          >
            <p>
              {selectedSystemRole
                ? systemAgentDefinitions[selectedSystemRole].description
                : 'Контекст и чтение файлов текущего проекта, библиотека, веб-поиск и проверка результата.'}
            </p>
            <p className="subtle">Встроенный обязательный MCP. Отключение и удаление недоступны.</p>
            <p className="subtle">
              {selectedSystemRole === 'assistant'
                ? 'Подключается при запуске помощника.'
                : selectedSystemRole
                  ? 'Подключается при запуске библиотечного агента.'
                  : 'Подключается при запуске проектного агента.'}
            </p>
            {selectedSystemRole !== 'assistant' && (
              <p className="subtle">
                Общий инструмент изображений использует API-подключение из настроек студии. Его
                доступность проверяется при открытии Pi; ключ и вторая модель в профиль агента не
                добавляются.
              </p>
            )}
          </Disclosure>
        </div>
      )}
      {!selectedAgent[field].length && field !== 'mcps' && (
        <p>Ресурсы не добавлены. Выберите их из общего каталога.</p>
      )}
      {selectedAgent[field].map((id) => {
        const key = `${field}:${id}`;
        const resource = resources.find((item) => item.kind === field && item.id === id);
        const binding = selectedAgent.capabilitySettings?.[key] ?? { enabled: true };
        const updateBinding = (update: Partial<typeof binding>) =>
          updateAgent({
            capabilitySettings: {
              ...selectedAgent.capabilitySettings,
              [key]: { ...binding, ...update },
            },
          });
        return (
          <div className="resource-binding" key={id} data-removable>
            <Disclosure
              label={resource?.name ?? id}
              leading={
                <Switch
                  checked={binding.enabled}
                  label={`Использовать: ${id}`}
                  onChange={(enabled) => updateBinding({ enabled })}
                />
              }
              actions={
                <HoverDeleteButton
                  label={`Убрать ${id} у агента`}
                  description="Убирается только связь с этим агентом. Ресурс и настройки других агентов сохраняются."
                  onDelete={() => {
                    const saved = [...selectedAgent[field]];
                    updateAgent({ [field]: saved.filter((item) => item !== id) });
                    demo('Связь с ресурсом убрана.', {
                      label: 'Вернуть',
                      onClick: () => updateAgent({ [field]: saved }),
                    });
                  }}
                />
              }
            >
              <p>
                {resource?.description ??
                  'Ресурс отсутствует в общем каталоге. Восстановите его перед запуском.'}
              </p>
              <p className="subtle">
                {resource
                  ? `${resource.version ? `${resource.version} · ` : ''}${resourceStatus(resource, !!window.studio)}`
                  : 'Недоступен'}
              </p>
            </Disclosure>
          </div>
        );
      })}
      <AddArea label={`Добавить ${agentTab}`} onClick={() => setCatalog(true)} />
      {catalog && (
        <Modal
          title={`Общий каталог · ${agentTab}`}
          onClose={() => setCatalog(false)}
          footer={<Button onClick={() => setCatalog(false)}>Готово</Button>}
        >
          <ResourceCatalog
            kind={field}
            attached={selectedAgent[field]}
            onPick={(id) => updateAgent({ [field]: [id, ...selectedAgent[field]] })}
          />
        </Modal>
      )}
    </div>
  );
}
