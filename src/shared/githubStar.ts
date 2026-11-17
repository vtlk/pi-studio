export const githubRepositoryUrl = 'https://github.com/vtlk/pi-studio';
export const githubStarInterval = 3 * 60 * 60_000;
export type GitHubStarChoice = 'open' | 'later';
export interface GitHubStarStatus {
  due: boolean;
  disabled: boolean;
  revision: number;
  error?: 'read' | 'write' | 'open';
}
export interface GitHubStarState extends GitHubStarStatus {
  canPresent: boolean;
}
export function isGitHubStarState(value: unknown): value is GitHubStarState {
  if (!value || typeof value !== 'object') return false;
  const state = value as GitHubStarState;
  return (
    typeof state.due === 'boolean' &&
    typeof state.disabled === 'boolean' &&
    typeof state.canPresent === 'boolean' &&
    Number.isSafeInteger(state.revision) &&
    state.revision >= 0 &&
    (state.error === undefined || ['read', 'write', 'open'].includes(state.error))
  );
}
