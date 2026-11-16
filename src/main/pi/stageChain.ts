import { t } from '../../shared/i18n/index.ts';
import type { WorkspaceProject } from '../../shared/project.ts';
import type { PreparedRun } from './ContextBuilder.ts';
import type { validateCompletedOutputs } from './completeStage.ts';
import { join } from 'node:path';

export function nextEnabledStage(project: WorkspaceProject, agentId: string) {
  const index = project.agents.findIndex((agent) => agent.profile.id === agentId);
  if (index < 0) throw new Error(t('error.stageChain.theCurrentAgentIsNo'));
  return project.agents.slice(index + 1).find((agent) => agent.profile.enabled);
}
export function nextStageMessage(
  run: PreparedRun,
  outputs: Awaited<ReturnType<typeof validateCompletedOutputs>>,
  message: string,
) {
  return `Продолжи выполнение пользовательского задания по своим текущим инструкциям.\n\nЗадание предыдущего этапа:\n${message}\n\nПроверенные выходные файлы этапа «${run.agent.profile.name}»:\n${outputs.map((file) => join(run.record.output, file.path)).join('\n')}\n\nИспользуй рабочую папку и пути результатов из своего текущего системного контекста. В общем режиме работай прямо в папке проекта без Output и папок агентов. Обязательных согласований персонажей, сцен и рендера нет. При реальном вопросе, ошибке или недостающем входе вызови report_blocked и дождись пользователя. По окончании явно сообщи complete_stage с файлами результата.`;
}
