import { resourceLabel } from '@/shared/model/localizedResources';
import { t, i18n } from '../../../../shared/i18n/index.ts';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { optionalBuiltinMcps } from '../../../../shared/builtinResources';
import { ResourceCatalog } from '@/features/resources/ui/ResourceCatalog';
import { Button } from '@/shared/ui';

export function McpPicker({
  attached,
  onPick,
}: {
  attached: string[];
  onPick: (id: string) => void;
}) {
  useTranslation(undefined, { i18n });
  const [mode, setMode] = useState('builtin');
  return (
    <>
      <nav className="segmented" aria-label={t('McpPicker.mcpSource')}>
        {['builtin', 'custom'].map((item) => (
          <button
            key={item === 'builtin' ? t('McpPicker.builtIn') : t('McpPicker.customMcp')}
            className={mode === item ? 'active' : ''}
            aria-pressed={mode === item}
            onClick={() => setMode(item)}
          >
            {item === 'builtin' ? t('McpPicker.builtIn') : t('McpPicker.customMcp')}
          </button>
        ))}
      </nav>
      {mode === 'builtin' ? (
        optionalBuiltinMcps.map((resource) => (
          <div className="resource-row" key={resource.id}>
            <div>
              <strong>{resourceLabel(resource, 'name')}</strong>
              <p>{resourceLabel(resource, 'description')}</p>
            </div>
            <Button
              kind="primary"
              disabled={attached.includes(resource.id)}
              onClick={() => onPick(resource.id)}
            >
              {attached.includes(resource.id) ? t('McpPicker.added') : t('McpPicker.addToAgent')}
            </Button>
          </div>
        ))
      ) : (
        <ResourceCatalog kind="mcps" attached={attached} onPick={onPick} />
      )}
    </>
  );
}
