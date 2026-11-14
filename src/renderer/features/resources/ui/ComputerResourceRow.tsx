import { Disclosure } from '@/shared/ui/Disclosure';
import { computerMcp } from '../../../../shared/builtinResources';
import { ComputerResourceStatus } from './ComputerResourceStatus';

export function ComputerResourceRow() {
  return (
    <div className="resource-binding" data-builtin-mcp>
      <Disclosure
        label={computerMcp.name}
        locked="Обязательный MCP — нельзя отключить или удалить"
        reserveActions
      >
        <p>{computerMcp.description}</p>
        <ComputerResourceStatus />
      </Disclosure>
    </div>
  );
}
