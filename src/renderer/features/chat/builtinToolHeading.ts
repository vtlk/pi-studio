import { t, type MessageKey } from '../../../shared/i18n/index.ts';
import messages from '../../../shared/i18n/en.json' with { type: 'json' };

const builtinNames = /^mcp__(pi_studio_browser|pi_studio_computer|pi_studio|team)__(\w+)$/;
const agentActions = new Set([
  'read_agent_settings',
  'configure_agent',
  'transfer_agent',
  'assign_resource',
  'say_to',
  'say_to_agent',
  'list_output',
  'read_output',
]);

export function builtinToolHeading(
  name: string,
  args: Record<string, unknown>,
  agentNames?: ReadonlyMap<string, string>,
) {
  const match = builtinNames.exec(name);
  if (!match) return;
  let [, group, action] = match;
  if (group === 'pi_studio_browser') action = action.replace(/^browser_/, '');
  if (action === 'read_agent_settings' && group === 'team') group = 'pi_studio';
  const key =
    `ToolCard.builtin.${group}.${action === 'transfer_agent' && args.mode === 'copy' ? 'copy_agent' : action}` as MessageKey;
  if (!Object.hasOwn(messages, key)) return;
  const ids =
    action === 'read_agent_settings' && Array.isArray(args.agent_ids)
      ? args.agent_ids.slice(0, 5)
      : agentActions.has(action)
        ? [args.agent_id ?? args.agentId ?? (action === 'configure_agent' ? args.id : undefined)]
        : [];
  const names = ids.flatMap((id) => {
    if (typeof id !== 'string') return [];
    const label = agentNames?.get(id)?.trim();
    return label ? [label.slice(0, 80)] : [];
  });
  return {
    name,
    label: t(key),
    target: names.length ? names.map((label) => `«${label}»`).join(', ') : '',
    friendly: true,
    builtin: true,
  };
}
