import { renderLibraryPreview } from './renderLibraryPreview.ts';
import type { PreviewRenderer } from './previewOptions.ts';
import { rigActions, rigEmotions } from '../../shared/characterRig.ts';
import type { SessionTool } from '../pi/RunChannel.ts';
import type { PreparedRun } from '../pi/ContextBuilder.ts';
import { hasLibraryMcp } from '../../shared/builtinResources.ts';
import type { Agent } from '../../shared/studio.ts';
import type { StudioService } from '../storage/StudioStore.ts';
import { stableId } from '../storage/validation.ts';
import { libraryKind } from './manifest.ts';
import { safePath } from '../storage/files.ts';
import { characterRigContract } from '../../shared/characterRigContract.ts';

const string = { type: 'string', minLength: 1, maxLength: 500 };
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
export const libraryTools: SessionTool[] = [
  {
    name: 'library_get_contract',
    description:
      'Read the exact data-only library publication contract, including the versioned SVG/rig.json animation schema. Studio never executes generated scripts or imports app code as preview logic.',
    inputSchema: schema({}),
  },
  {
    name: 'library_find_assets',
    description:
      'Find validated current characters/locations in the shared library of this studio, with stable IDs and versions. Read current source files through library_get_asset/native read.',
    inputSchema: schema({
      kind: { enum: ['characters', 'locations'] },
      query: { type: 'string', maxLength: 500 },
    }),
  },
  {
    name: 'library_get_asset',
    description:
      'Read one validated library asset manifest and its absolute local directory. Omit version for the latest version; an explicit version is pinned. No executable preview scripts are loaded.',
    inputSchema: schema(
      {
        kind: { enum: ['characters', 'locations'] },
        id: string,
        version: { type: 'integer', minimum: 1 },
      },
      ['kind', 'id'],
    ),
  },
  {
    name: 'library_prepare_asset',
    description:
      'Prepare a new asset or a modification of existingId in this agent output. Returns a staging token/directory and asset.json. Write reference.png/preview.png and optional static SVG there using native bash/assigned production tools. Do not change identity/version/createdAt or application code. This does not publish or overwrite existing files.',
    inputSchema: schema(
      {
        kind: { enum: ['characters', 'locations'] },
        title: string,
        existingId: string,
        description: { type: 'string', maxLength: 20000 },
        category: { type: 'string', maxLength: 200 },
      },
      ['kind', 'title'],
    ),
  },
  {
    name: 'library_render_preview',
    description:
      'Render a deterministic control PNG of this agent’s prepared asset with trusted Studio code. Reference PNG and declared SVG/rig must be valid; preview PNG may be absent. Supports rig pose/time or location camera. Returns a PNG path in this output for native read; copy a chosen frame to the manifest preview path before validate/publish. Never runs generated code, calls a model, publishes, or changes source/reference files.',
    inputSchema: schema(
      {
        token: string,
        width: { type: 'integer', minimum: 64, maximum: 2048 },
        height: { type: 'integer', minimum: 64, maximum: 2048 },
        character: schema({
          action: { enum: rigActions },
          emotion: { enum: rigEmotions },
          time: {
            type: 'number',
            minimum: 0,
            maximum: 3600,
            description:
              'Shared animation-clock seconds. For a fully closed automatic blink use time 3.54 and blink true; compare with the same time/pose and blink false.',
          },
          intensity: { type: 'number', minimum: 0, maximum: 1 },
          headTilt: { type: 'number', minimum: -10, maximum: 10 },
          gazeX: { type: 'number', minimum: -1, maximum: 1 },
          gazeY: { type: 'number', minimum: -1, maximum: 1 },
          autoGaze: { type: 'boolean' },
          blink: {
            type: 'boolean',
            description:
              'Enable the periodic automatic blink (4.1-second cycle, left starts at 3.4, right at 3.41). It does not close eyes immediately. Both lids are closed at time 3.54; at time 0.13 they remain open.',
          },
        }),
        camera: schema({
          zoom: { type: 'number', minimum: 1, maximum: 4 },
          x: { type: 'number', minimum: -16384, maximum: 16384 },
          y: { type: 'number', minimum: -16384, maximum: 16384 },
        }),
      },
      ['token'],
    ),
  },
  {
    name: 'library_validate_asset',
    description:
      'Check prepared PNG, SVG and optional character rig data without publishing. No human approval state; an unrigged character stays static.',
    inputSchema: schema({ token: string }, ['token']),
  },
  {
    name: 'library_publish_asset',
    description:
      'Revalidate the prepared data, preserve existing versions, and atomically publish to this studio library. Same existing ID updates its card. Temporary staging is removed after success. Cannot publish a preparation belonging to another project/agent.',
    inputSchema: schema({ token: string }, ['token']),
  },
];
export const libraryContract = {
  schemaVersion: 1,
  workflow: [
    'library_prepare_asset',
    'Write generated data files into stagingDirectory with native tools',
    'Optional library_render_preview to inspect a rig pose or camera; copy a selected PNG to the manifest preview path',
    'library_validate_asset',
    'library_publish_asset',
  ],
  manifestExample: {
    schemaVersion: 1,
    id: '<id from prepare>',
    kind: 'characters',
    version: 1,
    title: 'Character',
    description: '',
    category: '',
    createdAt: '<number from prepare>',
    files: { reference: 'reference.png', preview: 'preview.png', vector: 'character.svg' },
  },
  requirements: [
    'reference and preview are PNG files; vector is an optional static SVG with local fragment references only',
    'Use relative paths within the prepared folder. No symlinks or external SVG resources. Preserve editable sources in source/ if needed.',
    'File limits: PNG up to 32 MiB, 16384 pixels per side and 128 MiB inflated data; static SVG up to 2 MiB. Total: 256 MiB and 1000 files per published asset.',
    'No approval or manual import step. The user reviews results and requests changes in the same Pi dialogue.',
    'Only trusted application code performs previews. Generated JavaScript/HTML/TSX is never executed by the library viewer.',
    'Characters may add files.rig referencing a validated pistudio-character-1 rig.json and files.vector referencing compatible SVG. See characterRig below. No rig means explicitly static; location rigs are not supported.',
    'Updates use existingId and preserve earlier versions, not duplicate cards. No instruction copies are stored in asset packages.',
    'library_render_preview accepts this agent preparation token before preview.png exists. Defaults: 512x512; rig idle/neutral at time 0, intensity 1, zero tilt/manual gaze, no auto blink/gaze. Camera x/y are pixels after fit, clamped like the UI; zoom 1-4. Copy the chosen returned PNG into the declared preview path before validate/publish.',
    'For a deterministic closed-eye control frame, use character:{action:"idle",emotion:"neutral",time:3.54,blink:true}. Compare with the same time/pose and blink:false. The blink flag enables the periodic automatic cycle, not an immediate UI blink; the UI button starts its own local blink. A sample at time 0.13 has not reached the automatic blink.',
  ],
  characterRig: characterRigContract,
};

export function libraryTool(
  service: StudioService,
  run: PreparedRun,
  name: string,
  args: Record<string, unknown>,
  scope: 'project' | 'library-service' = 'project',
  previewRenderer?: PreviewRenderer,
) {
  return service.serialize(async () => {
    const store = await service.load();
    const current = (store.bootstrap().sections.agents as Agent[]).find(
      (item) => item.id === run.agent.profile.id,
    );
    if (!run.libraryAccess || !current || !hasLibraryMcp(current))
      throw new Error('Библиотечный MCP не назначен этому агенту или выключен.');
    const root =
      scope === 'library-service'
        ? await safePath(store.folder, `.pistudio/library-runs/${stableId(run.project.id)}`)
        : await store.projects.directory(run.project.id);
    if (root !== run.projectRoot) throw new Error('Папка студии/проекта изменилась.');
    const library = store.library;
    if (name === 'library_get_contract') return libraryContract;
    if (name === 'library_find_assets') {
      const kind = args.kind === undefined ? undefined : libraryKind(args.kind);
      if (args.query !== undefined && (typeof args.query !== 'string' || args.query.length > 500))
        throw new Error('Некорректный поиск материала.');
      const query = String(args.query ?? '').toLowerCase();
      const list = await library.list();
      const hidden = new Set((store.bootstrap().sections.hiddenLibraryIds ?? []) as string[]);
      return {
        assets: list.assets
          .filter(
            (asset) =>
              !hidden.has(asset.id) &&
              (!kind || asset.library.kind === kind) &&
              `${asset.title} ${asset.description ?? ''}`.toLowerCase().includes(query),
          )
          .slice(0, 100)
          .map((asset) => ({
            id: asset.id,
            kind: asset.library.kind,
            version: asset.library.version,
            title: asset.title,
          })),
        warnings: list.warnings,
      };
    }
    if (name === 'library_get_asset')
      return library.get(
        libraryKind(args.kind),
        stableId(args.id),
        args.version === undefined ? undefined : (args.version as number),
      );
    if (name === 'library_prepare_asset') return library.prepare(run.record.output, args);
    if (typeof args.token !== 'string') throw new Error('Нужен идентификатор подготовки.');
    if (name === 'library_render_preview') {
      if (!previewRenderer)
        throw new Error('Штатный рендер контрольного кадра недоступен в этом запуске.');
      return renderLibraryPreview(library, run.record.output, args, previewRenderer);
    }
    if (name === 'library_validate_asset') return library.validate(run.record.output, args.token);
    if (name === 'library_publish_asset') return library.publish(run.record.output, args.token);
    throw new Error('Неизвестный инструмент библиотеки.');
  });
}
