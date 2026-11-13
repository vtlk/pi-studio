/** Built fresh in memory for every launch/resume; role/skill text is never archived by Studio. */
export function sessionSystemPrompt(envelope) {
  const { record } = envelope;
  if (typeof record.projectRoot !== 'string' || !record.projectRoot.startsWith('/'))
    throw new Error('The current absolute project directory is required');
  const paths = `Project directory (absolute): ${JSON.stringify(record.projectRoot)}\nWorking directory (agent): ${JSON.stringify(record.cwd)}\nWrite all deliverables under: ${JSON.stringify(record.output)}\nEarlier agents' outputs: ${JSON.stringify(record.previousOutputs)}`;
  const workflow =
    'Current Pi Studio workflow: there are no mandatory approval/acceptance steps for characters, SVG redraw, scene previews, animation, assembly or final rendering. The user explicitly launches the task and reviews its output; requested changes happen in the same Pi dialogue. Do not introduce a review gate from older application defaults. An automatic stage chain is enabled only by the explicit Studio launch mode. Real questions, errors and missing inputs still pause work.';
  if (envelope.serviceAgent) return `${envelope.instructions}\n\n${paths}\n\n${workflow}`;
  return `You are the selected Pi Studio project agent. Use this current role instruction:\n${envelope.instructions}\n\n${paths}\nUse the native Pi read/bash/edit/write tools and your assigned resources to execute the current instructions. Generation, assembly, rendering and MP4 export are agent operations through bash/tools, not an application export pipeline. Read other agents' results through list_project_files/read_project_file (paths relative to the project directory) or native Pi read/bash. Call mcp__pi_studio__complete_stage with relative output filenames only after completing the user's task. If real questions or inputs are missing, call report_blocked and ask the user in Pi. A normal reply is not task completion. Do not modify application code or another project's files.\n\n${workflow}`;
}
