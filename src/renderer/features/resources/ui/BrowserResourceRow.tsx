import { Disclosure } from '@/shared/ui/Disclosure';
import { browserMcp } from '../../../../shared/builtinResources';
import { BrowserResourceStatus } from './BrowserResourceStatus';

export function BrowserResourceRow() {
  return (
    <div className="resource-binding" data-builtin-mcp>
      <Disclosure
        label={browserMcp.name}
        locked="Обязательный MCP — нельзя отключить или удалить"
        reserveActions
      >
        <p>{browserMcp.description}</p>
        <BrowserResourceStatus />
      </Disclosure>
    </div>
  );
}
