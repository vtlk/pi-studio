import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, rename, rm, lstat } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { tmpdir } from 'node:os';
import { t } from '../../shared/i18n/index.ts';
import type { Resource } from '../../shared/resources.ts';
import type { StudioService } from '../storage/StudioStore.ts';
import type { PreparedRun } from '../pi/ContextBuilder.ts';
import { assertAdministrationScope } from '../pi/administrationScope.ts';
import { assertSkillTargets, skillTargetIds } from '../storage/assignDownloadedSkill.ts';
import { safePath, isMissing } from '../storage/files.ts';
import { transferTimeouts } from '../network/transfer.ts';
import { skillSource } from './skillSource.ts';
import { downloadSkill } from './skillTransfer.ts';
import { extractSkillArchive } from './skillArchive.ts';
import { downloadGithubSkill } from './githubSkill.ts';
import { inspectDownloadedSkill } from './inspectDownloadedSkill.ts';

export class RemoteSkillInstaller {
  private readonly service: StudioService;
  private readonly request: typeof fetch;
  constructor(service: StudioService, request = fetch) {
    this.service = service;
    this.request = request;
  }
  async install(
    run: PreparedRun,
    args: Record<string, unknown>,
    signal = new AbortController().signal,
  ) {
    const ids = skillTargetIds(args.agentIds);
    if (
      args.sha256 !== undefined &&
      (typeof args.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(args.sha256))
    )
      throw Error(t('error.remoteSkill.hash'));
    const folder = await this.service.serialize(async () => {
      const store = await this.service.load();
      await assertAdministrationScope(store, run);
      assertSkillTargets(store.bootstrap().sections, ids);
      signal.throwIfAborted();
      return store.folder;
    });
    const source = await skillSource(args, signal, this.request);
    const temporary = await mkdtemp(join(tmpdir(), 'pistudio-skill-url-'));
    let staged: string | undefined,
      final: string | undefined,
      ownsFinal = false,
      committed = false;
    try {
      const unpacked = join(temporary, 'unpacked');
      let skillFolder = unpacked;
      let sha256: string | undefined;
      let unpackSignal = signal;
      if (source.github && args.sha256 === undefined) {
        const selection = await downloadGithubSkill(
          {
            ...source.github,
            commit: source.commit,
            path: source.path,
            exact: args.skillPath !== undefined || source.github.kind === 'blob',
          },
          unpacked,
          signal,
          this.request,
        );
        if (selection) return { installed: false, ...selection, githubCommit: source.commit };
      } else {
        const archive = join(temporary, 'source.zip');
        sha256 = await downloadSkill(source.url, archive, signal, this.request);
        if (args.sha256 !== undefined && sha256 !== String(args.sha256).toLowerCase())
          throw Error(t('error.remoteSkill.hash'));
        unpackSignal = AbortSignal.any([signal, AbortSignal.timeout(transferTimeouts.unpack)]);
        const files = await extractSkillArchive(archive, unpacked, unpackSignal);
        const first = files[0]?.split('/')[0];
        const prefix =
          first && files.every((file) => file.startsWith(first + '/')) ? first + '/' : '';
        const paths = files
          .filter((file) => posix.basename(file) === 'SKILL.md')
          .map((file) => ({
            file,
            path: posix.dirname(file.slice(prefix.length)).replace(/^\.$/, ''),
          }));
        if (!paths.length) throw Error(t('error.remoteSkill.noSkill'));
        const selected =
          source.path !== undefined
            ? paths.find((item) => item.path === source.path)
            : paths.length === 1
              ? paths[0]
              : undefined;
        if (!selected) {
          if (source.path !== undefined) throw Error(t('error.remoteSkill.noSkill'));
          if (paths.length > 100) throw Error(t('error.remoteSkill.size'));
          const skills = [];
          for (const item of paths) {
            unpackSignal.throwIfAborted();
            try {
              const { skill } = await inspectDownloadedSkill(
                join(unpacked, ...posix.dirname(item.file).split('/')),
                unpackSignal,
              );
              skills.push({ path: item.path, name: skill.name, description: skill.description });
            } catch {
              skills.push({ path: item.path, invalid: true });
            }
          }
          unpackSignal.throwIfAborted();
          return {
            installed: false,
            selectionRequired: true,
            skills,
            archiveSha256: sha256,
            ...(source.commit ? { githubCommit: source.commit } : {}),
          };
        }
        skillFolder = join(unpacked, ...posix.dirname(selected.file).split('/'));
      }
      const { skill, frontmatterNormalized } = await inspectDownloadedSkill(
        skillFolder,
        unpackSignal,
      );
      unpackSignal.throwIfAborted();
      const id = `skill-${randomUUID()}`;
      const root = await safePath(folder, '.pistudio/skills', true);
      await mkdir(root, { recursive: true });
      staged = await mkdtemp(join(root, `.installing-${id}-`));
      final = await safePath(root, id, true);
      await cp(skillFolder, join(staged, 'skill'), {
        recursive: true,
        force: false,
        errorOnExist: true,
      });
      unpackSignal.throwIfAborted();
      const resource: Resource = {
        id,
        name: skill.name,
        description: skill.description,
        kind: 'skills',
        source: final,
        localSkill: true,
        managedSkill: true,
        version: 'Текущий локальный файл',
        transport: '',
        args: '',
        credential: '',
        contents: '',
        createdAt: Date.now(),
        check: { status: 'available', checkedAt: Date.now() },
      };
      await this.service.serialize(async () => {
        const store = await this.service.load();
        if (store.folder !== folder) throw Error(t('registerTeamHandlers.studioFolderChanged'));
        await assertAdministrationScope(store, run);
        signal.throwIfAborted();
        // Revalidate destinations/targets against current settings after all network work.
        assertSkillTargets(store.bootstrap().sections, ids);
        await safePath(root, id, true);
        try {
          await lstat(final!);
          throw Error(t('error.remoteSkill.collision'));
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
        await rename(join(staged!, 'skill'), final!);
        ownsFinal = true;
        signal.throwIfAborted();
        await store.addAssignedSkill(resource, ids);
        committed = true;
      });
      return {
        installed: true,
        resource,
        agentIds: ids,
        ...(sha256 ? { archiveSha256: sha256 } : {}),
        ...(source.commit ? { githubCommit: source.commit } : {}),
        ...(frontmatterNormalized ? { frontmatterNormalized: true } : {}),
        loadedInAgentSession: false,
        updatedProjectSnapshots: false,
      };
    } finally {
      if (staged)
        await rm(staged, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
      if (final && ownsFinal && !committed)
        await rm(final, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
      await rm(temporary, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
    }
  }
}
