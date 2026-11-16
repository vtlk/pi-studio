import type { Plugin } from 'vite';

type NativeBundle = Record<
  string,
  { type: 'chunk'; modules: Record<string, unknown>; code: string } | { type: 'asset' }
>;

/** Build-time gate: the native renderer may not import the separate web example graph. */
export function inspectNativeRenderer(bundle: NativeBundle) {
  const modules = new Set<string>();
  for (const output of Object.values(bundle)) {
    if (output.type !== 'chunk') continue;
    for (const id of Object.keys(output.modules)) modules.add(id.replaceAll('\\', '/'));
    for (const marker of [
      'Посылка с характером',
      'men-02-garage-guy',
      'Сохраняй единый стиль проекта: геометрическая 2D-графика',
    ])
      if (output.code.includes(marker))
        throw new Error('Web example data in native renderer chunk.');
  }
  const forbidden = [...modules].filter((id) =>
    /\/renderer\/(fixtures\/|main\.web\.tsx)|\/useDemoWorkspaceState\.ts$|\/public\/assets\/source\.json/.test(
      id,
    ),
  );
  if (forbidden.length)
    throw new Error(`Web-only modules imported by native renderer:\n${forbidden.join('\n')}`);
  if ([...modules].some((id) => /\/node_modules\/(?:@remotion\/|remotion\/)/.test(id)))
    throw new Error('User-managed Remotion packages must not be bundled in Pi Studio.');
  if (![...modules].some((id) => id.endsWith('/renderer/main.tsx')))
    throw new Error('Native renderer entry is missing.');
  return { schemaVersion: 1, entry: 'main.tsx', modules: modules.size, webExampleModules: 0 };
}

export function nativeRendererGuard(): Plugin {
  return {
    name: 'studio-native-renderer-guard',
    generateBundle(_options, bundle) {
      const report = inspectNativeRenderer(bundle);
      this.emitFile({
        type: 'asset',
        fileName: 'native-build.json',
        source: JSON.stringify(report),
      });
    },
  };
}
