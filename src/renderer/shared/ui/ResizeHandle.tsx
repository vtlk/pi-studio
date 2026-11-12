import { useRef, useState } from 'react';

export function ResizeHandle({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const drag = useRef<{ pointerId: number; startX: number; startValue: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const stop = () => {
    drag.current = null;
    setDragging(false);
  };
  return (
    <div
      className="resize-handle"
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      data-dragging={dragging || undefined}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, startX: event.clientX, startValue: value };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (drag.current?.pointerId === event.pointerId)
          onChange(clamp(drag.current.startValue + event.clientX - drag.current.startX));
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        stop();
      }}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onKeyDown={(event) => {
        const next =
          event.key === 'ArrowLeft'
            ? value - 10
            : event.key === 'ArrowRight'
              ? value + 10
              : event.key === 'Home'
                ? min
                : event.key === 'End'
                  ? max
                  : null;
        if (next !== null) {
          event.preventDefault();
          onChange(clamp(next));
        }
      }}
    />
  );
}
