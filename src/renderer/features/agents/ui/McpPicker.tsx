import { useState } from 'react';
import { libraryMcp } from '../../../../shared/builtinResources';
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
      {mode === 'Встроенные' && !allowLibrary ? (
        <p>Административный MCP помощника уже подключён. Библиотека назначается обычным агентам.</p>
      ) : mode === 'Встроенные' ? (
        <div className="resource-row">
          <div>
            <strong>{libraryMcp.name}</strong>
            <p>{libraryMcp.description}</p>
          </div>
          <Button
            kind="primary"
            disabled={attached.includes(libraryMcp.id)}
            onClick={() => onPick(libraryMcp.id)}
          >
            {attached.includes(libraryMcp.id) ? 'Добавлен' : 'Добавить агенту'}
          </Button>
        </div>
      ) : (
        <ResourceCatalog kind="mcps" attached={attached} onPick={onPick} />
      )}
    </>
  );
}
