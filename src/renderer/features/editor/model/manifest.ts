import { t } from '../../../../shared/i18n/index.ts';
import type { OutputFile, OutputEntry } from '@/features/project/model/workspace.types';
import { listOutputFiles } from '../../project/model/outputTree.ts';
import type { DemoTimeline, DemoTrack } from './timeline';
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function isTrack(value: unknown): value is DemoTrack {
  return (
    object(value) &&
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    typeof value.muted === 'boolean' &&
    typeof value.gain === 'number' &&
    typeof value.pan === 'number' &&
    Array.isArray(value.clips) &&
    value.clips.every(
      (clip: unknown) =>
        object(clip) &&
        typeof clip.id === 'string' &&
        typeof clip.label === 'string' &&
        Number.isInteger(clip.start) &&
        Number.isInteger(clip.duration) &&
        Number(clip.start) >= 0 &&
        Number(clip.duration) > 0 &&
        (clip.src === undefined || typeof clip.src === 'string'),
    )
  );
}
export function resolveOutputPath(parent: string[], relative: string): string | null {
  if (!relative || relative.startsWith('/') || /[:\\]/.test(relative) || relative.includes('\0'))
    return null;
  const parts = [...parent];
  for (const part of relative.split('/')) {
    if (part === '.' || !part) continue;
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join('/');
}
export type ManifestResult =
  { ok: true; name: string; timeline: DemoTimeline } | { ok: false; error: string };
export function inspectManifest(file: OutputFile, entries: OutputEntry[]): ManifestResult {
  try {
    const manifest: unknown = JSON.parse(file.content ?? '');
    if (!object(manifest) || manifest.type !== 'pi-studio.video-project')
      throw new Error(t('manifest.invalidManifestType'));
    if (manifest.schemaVersion !== 1) throw new Error(t('manifest.unsupportedManifestVersion'));
    if (manifest.editor !== 'remotion-editor-starter') throw new Error(t('manifest.unknownEditor'));
    if (
      typeof manifest.name !== 'string' ||
      !manifest.name.trim() ||
      typeof manifest.state !== 'string'
    )
      throw new Error(t('manifest.missingNameOrState'));
    const files = listOutputFiles(entries);
    const current = files.find((item) => item.file.id === file.id);
    if (!current) throw new Error(t('manifest.manifestMissingFromResults'));
    const statePath = resolveOutputPath(current.path.slice(0, -1), manifest.state);
    if (!statePath) throw new Error(t('manifest.statePathLeavesTheOutputFolder'));
    const stateFile = files.find((item) => item.path.join('/') === statePath);
    if (!stateFile) throw new Error(t('manifest.stateFileNotFound', { value1: manifest.state }));
    const state: unknown = JSON.parse(stateFile.file.content ?? '');
    if (!object(state) || state.type !== 'pi-studio.prototype-timeline')
      throw new Error(t('manifest.stateIsIncompatibleWithThePreviewThe'));
    if (
      state.fps !== 30 ||
      state.width !== 1080 ||
      state.height !== 1920 ||
      !Array.isArray(state.tracks) ||
      !state.tracks.every(isTrack) ||
      typeof state.subtitles !== 'string'
    )
      throw new Error(t('manifest.invalidPreviewStateStructure'));
    const ids = state.tracks.flatMap((track) => [track.id, ...track.clips.map((clip) => clip.id)]);
    if (new Set(ids).size !== ids.length) throw new Error(t('manifest.duplicateTrackOrClipIds'));
    const timeline: DemoTimeline = {
      type: 'pi-studio.prototype-timeline',
      fps: 30,
      width: 1080,
      height: 1920,
      tracks: state.tracks,
      subtitles: state.subtitles,
    };
    for (const track of timeline.tracks)
      for (const clip of track.clips) {
        if (!clip.src) continue;
        const assetPath = resolveOutputPath(current.path.slice(0, -1), clip.src);
        const asset = files.find((item) => item.path.join('/') === assetPath);
        if (!asset) throw new Error(t('manifest.assetNotFound', { value1: clip.src }));
        clip.src = asset.file.src;
      }
    return { ok: true, name: manifest.name, timeline };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : t('manifest.invalidJson') };
  }
}
