import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage } from '../../../shared/chat';
import { t, i18n } from '../../../shared/i18n';
import { useAgentProfiles } from '@/features/agents/model/AgentProfiles';
import { agentName } from '@/shared/model/localizedProfiles';
import { indexToolCalls } from './toolCalls';
import { ToolCallCard, type ToolCardPreference } from './ToolCallCard';

export function ChatTranscript({
  messages,
  name,
  working,
}: {
  messages: ChatMessage[];
  name: string;
  working: boolean;
}) {
  useTranslation(undefined, { i18n });
  const preferences = useRef(new Map<string, ToolCardPreference>());
  const tools = indexToolCalls(messages);
  const { agents, systemAgents } = useAgentProfiles();
  const agentNames = new Map(
    [...agents, ...systemAgents].map((agent) => [agent.id, agentName(agent)]),
  );
  return messages.map((message, messageIndex) => {
    if (tools.matchedResults.has(messageIndex)) return null;
    if (message.role === 'toolResult' || message.role === 'bashExecution')
      return (
        <ToolCallCard
          key={`orphan-${message.id}`}
          entry={{
            key: `orphan-${message.toolCallId ?? message.id}`,
            call: {
              type: 'toolCall',
              name:
                message.toolName || (message.role === 'bashExecution' ? 'bash' : t('Chat.tool')),
              ...(message.command
                ? { arguments: JSON.stringify({ command: message.command }) }
                : {}),
            },
            result: message,
          }}
          working={false}
          preferences={preferences.current}
          agentNames={agentNames}
        />
      );
    return (
      <article className="pi-chat-message" data-role={message.role} key={message.id}>
        <span className="pi-chat-role">
          {message.role === 'user'
            ? t('Chat.you')
            : message.role === 'assistant'
              ? name
              : message.toolName || t('Chat.tool')}
        </span>
        {message.parts.map((part, index) =>
          part.type === 'toolCall' ? (
            <ToolCallCard
              key={tools.calls.get(`${messageIndex}:${index}`)!.key}
              entry={tools.calls.get(`${messageIndex}:${index}`)!}
              working={working && messageIndex === tools.currentMessageIndex}
              preferences={preferences.current}
              agentNames={agentNames}
            />
          ) : part.type === 'thinking' ? (
            <details className="pi-chat-thinking" key={index}>
              <summary>{t('Chat.thinking')}</summary>
              <p>{part.text}</p>
            </details>
          ) : part.type === 'image' ? (
            part.src ? (
              <img key={index} src={part.src} alt={t('Chat.image')} />
            ) : (
              <p key={index}>{t('Chat.image')}</p>
            )
          ) : (
            <div className="output-markdown" key={index}>
              <Markdown
                remarkPlugins={[remarkGfm]}
                skipHtml
                components={{
                  a: ({ href, children }) =>
                    /^https?:\/\//i.test(href ?? '') ? (
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {children}
                      </a>
                    ) : (
                      <span>{children}</span>
                    ),
                  img: ({ alt }) => <span>{alt || t('Chat.image')}</span>,
                }}
              >
                {part.text ?? ''}
              </Markdown>
            </div>
          ),
        )}
        {message.error && <p className="error-message">{message.error}</p>}
      </article>
    );
  });
}
