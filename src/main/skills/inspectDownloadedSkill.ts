import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { t } from '../../shared/i18n/index.ts';
import { readText } from '../storage/files.ts';
import { inspectSkill, parseSkill } from '../storage/skills.ts';

export async function inspectDownloadedSkill(folder: string, signal: AbortSignal) {
  try {
    return { skill: await inspectSkill(folder), frontmatterNormalized: false };
  } catch (error) {
    if (!(error instanceof Error) || error.message !== t('error.skills.invalidSkillMdYamlFront'))
      throw error;
    // Quote an unambiguous plain description in our temporary copy, preserving its text and body.
    const file = join(folder, 'SKILL.md');
    const original = await readText(file);
    const normalized = original.replace(
      /^(\uFEFF?---\r?\nname:[ \t]+[a-z0-9-]+\r?\ndescription:[ \t]+)([\p{L}\p{N}][^\r\n]*:[ \t]+[^\r\n]+)(\r?\n---(?=\r?\n|$))/u,
      (_match, start: string, description: string, end: string) =>
        start + JSON.stringify(description) + end,
    );
    if (normalized === original) throw error;
    const skill = parseSkill(normalized);
    signal.throwIfAborted();
    await writeFile(file, normalized, 'utf8');
    return { skill, frontmatterNormalized: true };
  }
}
