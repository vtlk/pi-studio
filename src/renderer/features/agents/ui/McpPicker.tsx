import { useState } from 'react';
import { optionalBuiltinMcps, libraryMcp } from '../../../../shared/builtinResources';
import { ResourceCatalog } from '@/features/resources/ui/ResourceCatalog';
import { Button } from '@/shared/ui';

export function McpPicker({
  attached,
  onPick,
  allowLibrary = true,
}: {
  attached: string[];
  onPick: (id: string) => void;
  allowLibrary?: boolean;
}) {
  const [mode, setMode] = useState('Встроенные');
  return (
    <>
      <nav className="segmented" aria-label="Источник MCP">
        {['Встроенные', 'Свой MCP'].map((item) => (
          <button
            key={item}
            className={mode === item ? 'active' : ''}
            aria-pressed={mode === item}
            onClick={() => setMode(item)}
          >
            {item}
          </button>
        ))}
      </nav>
      {mode === 'Встроенные' ? (
        optionalBuiltinMcps
          .filter((item) => allowLibrary || item.id !== libraryMcp.id)
          .map((resource) => (
            <div className="resource-row" key={resource.id}>
              <div>
                <strong>{resource.name}</strong>
                <p>{resource.description}</p>
              </div>
              <Button
                kind="primary"
                disabled={attached.includes(resource.id)}
                onClick={() => onPick(resource.id)}
              >
                {attached.includes(resource.id) ? 'Добавлен' : 'Добавить агенту'}
              </Button>
            </div>
          ))
      ) : (
        <ResourceCatalog kind="mcps" attached={attached} onPick={onPick} />
      )}
    </>
  );
}
