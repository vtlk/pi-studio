import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
const Context = createContext<{
  wrap: boolean;
  toggle: () => void;
  active: boolean;
  mark: (active: boolean) => void;
} | null>(null);
export function CodePreviewOptions({ children }: { children: ReactNode }) {
  const [wrap, setWrap] = useState(true);
  const [active, setActive] = useState(false);
  const mark = useCallback((value: boolean) => setActive(value), []);
  const value = useMemo(
    () => ({ wrap, active, mark, toggle: () => setWrap((previous) => !previous) }),
    [wrap, active, mark],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useCodePreviewOptions() {
  return useContext(Context);
}
export function useActiveCodePreview() {
  const options = useCodePreviewOptions();
  const mark = options?.mark;
  useEffect(() => {
    mark?.(true);
    return () => mark?.(false);
  }, [mark]);
  return options?.wrap ?? true;
}
