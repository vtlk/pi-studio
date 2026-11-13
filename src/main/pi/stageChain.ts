import type { WorkspaceProject } from '../../shared/project.ts';
import type { PreparedRun } from './ContextBuilder.ts';
import type { validateCompletedOutputs } from './completeStage.ts';
import { join } from 'node:path';

export function nextEnabledStage(project: WorkspaceProject, agentId: string) {
  const index = project.agents.findIndex((agent) => agent.profile.id === agentId);
  if (index < 0) throw new Error('Текущий агент больше не входит в цепочку проекта.');
  return project.agents.slice(index + 1).find((agent) => agent.profile.enabled);
}
export function nextStageMessage(
  run: PreparedRun,
  outputs: Awaited<ReturnType<typeof validateCompletedOutputs>>,
  message: string,
) {
  return `Продолжи выполнение пользовательского задания по своим текущим инструкциям.\n\nЗадание предыдущего этапа:\n${message}\n\nПроверенные выходные файлы этапа «${run.agent.profile.name}»:\n${outputs.map((file) => join(run.record.output, file.path)).join('\n')}\n\nРаботай только в output своего агента. При вопросе, ошибке, недостающем входе или обязательном согласовании вызови report_blocked и дождись пользователя. По окончании явно сообщи complete_stage с файлами результата.`;
}
