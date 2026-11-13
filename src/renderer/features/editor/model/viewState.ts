interface ViewState {
  frame: number;
  selected: string;
}
const states = new Map<string, ViewState>();
export function readVideoView(key: string): ViewState {
  return states.get(key) ?? { frame: 0, selected: '' };
}
export function rememberVideoView(key: string, state: ViewState) {
  states.delete(key);
  states.set(key, state);
  if (states.size > 64) states.delete(states.keys().next().value!);
}
