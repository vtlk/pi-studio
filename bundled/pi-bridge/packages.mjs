/** Resolve requested packages once with native Pi, then load their exact resources in this session. */
export async function resolveAssignedPackages(sdk, cwd, settingsManager, assigned) {
  const empty = { extensions: [], skills: [], prompts: [], themes: [] };
  if (!assigned.length) return empty;
  const manager = new sdk.DefaultPackageManager({
    cwd,
    agentDir: sdk.getAgentDir(),
    settingsManager,
  });
  const result = await manager.resolveExtensionSources(
    assigned.map((item) => item.source),
    { temporary: true },
  );
  if (result.installFailures?.length)
    throw new Error(
      'A selected Pi package could not be installed; the session will not run without it.',
    );
  const all = Object.keys(empty).flatMap((kind) => result[kind].filter((item) => item.enabled));
  if (assigned.some((source) => !all.some((item) => item.metadata.source === source.source)))
    throw new Error(
      'A selected Pi package has no available resources; the session will not substitute another package.',
    );
  return Object.fromEntries(
    Object.keys(empty).map((kind) => [
      kind,
      result[kind].filter((item) => item.enabled).map((item) => item.path),
    ]),
  );
}
