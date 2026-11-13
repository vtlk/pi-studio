import type { SessionTool } from '../pi/RunChannel.ts';
import type { PreparedRun } from '../pi/ContextBuilder.ts';
import type { StudioService } from '../storage/StudioStore.ts';
import { stableId } from '../storage/validation.ts';
import { libraryKind } from './manifest.ts';
import { safePath } from '../storage/files.ts';

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
      'Read the exact data-only library publication contract. Studio never executes generated scripts or imports app code as preview logic. Character rigs are not connected yet; PNG/static SVG publication is supported.',
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
    name: 'library_validate_asset',
    description:
      'Check prepared PNG/static SVG files and manifest without publishing. No human approval state, no animation claim for an unrigged asset.',
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
    'No approval or manual import step in the library. Production human approvals stay in the Pi/project workflow.',
    'Only trusted application code performs previews. Generated JavaScript/HTML/TSX is never executed by the library viewer.',
    'Dynamic rig.json playback is not implemented yet. Published characters are explicitly static; do not claim action/emotion controls are working for them.',
    'Updates use existingId and preserve earlier versions, not duplicate cards. No instruction copies are stored in asset packages.',
  ],
};

export function libraryTool(
  service: StudioService,
  run: PreparedRun,
  name: string,
  args: Record<string, unknown>,
  scope: 'project' | 'library-service' = 'project',
) {
  return service.serialize(async () => {
    const store = await service.load();
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
    if (name === 'library_validate_asset') return library.validate(run.record.output, args.token);
    if (name === 'library_publish_asset') return library.publish(run.record.output, args.token);
    throw new Error('Неизвестный инструмент библиотеки.');
  });
}
