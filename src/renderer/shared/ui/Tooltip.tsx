import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={350} skipDelayDuration={150}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export function Tooltip({
  label,
  children,
  open,
  onOpenChange,
  onlyWhenTruncated = false,
  overflowSelector,
}: {
  label: string;
  children: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onlyWhenTruncated?: boolean;
  overflowSelector?: string;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [hoverOpen, setHoverOpen] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const target = useCallback(
    () =>
      overflowSelector
        ? trigger.current?.querySelector<HTMLElement>(overflowSelector)
        : trigger.current,
    [overflowSelector],
  );
  const check = useCallback(() => {
    const element = target();
    return !!element && element.clientWidth > 0 && element.scrollWidth > element.clientWidth;
  }, [target]);
  useLayoutEffect(() => {
    if (!onlyWhenTruncated) return;
    const element = target();
    if (!element) return;
    const update = () => {
      const clipped = check();
      setTruncated(clipped);
      if (!clipped) setHoverOpen(false);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [onlyWhenTruncated, target, check, label]);
  return (
    <TooltipPrimitive.Root
      disableHoverableContent={onlyWhenTruncated}
      open={(open ?? hoverOpen) && (!onlyWhenTruncated || truncated)}
      onOpenChange={(next) => {
        const clipped = !onlyWhenTruncated || check();
        if (onlyWhenTruncated) setTruncated(clipped);
        setHoverOpen(next && clipped);
        onOpenChange?.(next && clipped);
      }}
    >
      <TooltipPrimitive.Trigger asChild ref={trigger}>
        {children}
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content className="ui-tooltip" sideOffset={6} collisionPadding={8}>
          {label}
          <TooltipPrimitive.Arrow className="ui-tooltip-arrow" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
