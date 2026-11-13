import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ReactElement, ReactNode } from 'react';

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
}: {
  label: string;
  children: ReactElement;
  open?: boolean;
}) {
  return (
    <TooltipPrimitive.Root open={open}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content className="ui-tooltip" sideOffset={6} collisionPadding={8}>
          {label}
          <TooltipPrimitive.Arrow className="ui-tooltip-arrow" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
