export function sessionSystemPrompt(
  envelope: {
    record: {
      projectRoot: string;
      cwd: string;
      output: string;
      previousOutputs: unknown;
      projectId: string;
    };
    instructions: string;
    resources?: { skills: { path: string }[] };
    serviceAgent?: boolean;
    teamAccess?: boolean;
  },
  packageSkillPaths?: string[],
): string;
