/** Built fresh in memory for every launch/resume; role/skill text is never archived by Studio. */
export function sessionSystemPrompt(envelope) {
  const { record } = envelope;
  if (typeof record.projectRoot !== 'string' || !record.projectRoot.startsWith('/'))
    throw new Error('The current absolute project directory is required');
  const paths = `Project directory (absolute): ${JSON.stringify(record.projectRoot)}\nWorking directory (agent): ${JSON.stringify(record.cwd)}\nWrite all deliverables under: ${JSON.stringify(record.output)}\nEarlier agents' outputs: ${JSON.stringify(record.previousOutputs)}`;
  if (envelope.serviceAgent) return `${envelope.instructions}\n\n${paths}`;
  return `You are the selected Pi Studio project agent. Use this current role instruction:\n${envelope.instructions}\n\n${paths}\nUse the native Pi read/bash/edit/write tools and your assigned resources to execute the current instructions. Generation, assembly, rendering and MP4 export are agent operations through bash/tools, not an application export pipeline. Read other agents' results through list_project_files/read_project_file (paths relative to the project directory) or native Pi read/bash. Call mcp__pi_studio__complete_stage with relative output filenames only after completing the user's task. If questions, required approvals or inputs are missing, call report_blocked and ask the user in Pi. A normal reply is not task completion. Do not modify application code or another project's files. Final rendering and SVG redraw/animation require human acceptance.`;
}
