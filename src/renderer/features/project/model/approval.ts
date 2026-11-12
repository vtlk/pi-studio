export interface ApprovalState {
  revision: number;
  acceptedRevision: number | null;
  acceptedScenes: number[];
}
export type ApprovalAction =
  | { type: 'accept-film' }
  | { type: 'revoke-film' }
  | { type: 'set-scenes'; scenes: number[] }
  | { type: 'change-scene'; scene: number };

export const initialApproval: ApprovalState = {
  revision: 1,
  acceptedRevision: null,
  acceptedScenes: [],
};
export function approvalReducer(state: ApprovalState, action: ApprovalAction): ApprovalState {
  switch (action.type) {
    case 'accept-film':
      return { ...state, acceptedRevision: state.revision };
    case 'revoke-film':
      return { ...state, acceptedRevision: null };
    case 'set-scenes':
      return { ...state, acceptedScenes: action.scenes };
    case 'change-scene':
      return {
        revision: state.revision + 1,
        acceptedRevision: null,
        acceptedScenes: state.acceptedScenes.filter((id) => id !== action.scene),
      };
  }
}
export const isFilmAccepted = (state: ApprovalState) => state.acceptedRevision === state.revision;
