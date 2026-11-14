import { useCallback, useContext, useEffect, useRef, useState, type SetStateAction } from 'react';
import type { StorageSection } from '../../../shared/storage';
import { StorageContext } from './Storage.context';

export function useStorage() {
  const value = useContext(StorageContext);
  if (!value) throw new Error('StorageProvider is missing');
  return value;
}
/** Each feature still owns its state. Only the current value goes to the shared disk writer. */
export function useStoredState<T>(key: StorageSection, initial: T | (() => T)) {
  const { bootstrap, save, isPending } = useStorage();
  const [value, update] = useState<T>(
    () =>
      (bootstrap?.sections[key] as T | undefined) ??
      (typeof initial === 'function' ? (initial as () => T)() : initial),
  );
  const latest = useRef(value);
  const external = bootstrap?.sections[key] as T | undefined;
  useEffect(() => {
    if (
      external === undefined ||
      isPending(key) ||
      JSON.stringify(external) === JSON.stringify(latest.current)
    )
      return;
    queueMicrotask(() => {
      if (!isPending(key)) {
        latest.current = external;
        update(external);
      }
    });
  }, [external, key, isPending]);
  const setValue = useCallback(
    (action: SetStateAction<T>) => {
      const previous = latest.current;
      const next = typeof action === 'function' ? (action as (previous: T) => T)(previous) : action;
      latest.current = next;
      update(next);
      save(key, next, previous);
    },
    [key, save],
  );
  return [value, setValue] as const;
}
