import {
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithRef,
} from 'react';
import { GripHorizontal } from 'lucide-react';
import { Tooltip } from './Tooltip';

/** Flat multiline editor with a visible lower-edge resize control. */
export function Textarea({
  className,
  style,
  ref,
  id,
  disabled,
  ...props
}: ComponentPropsWithRef<'textarea'>) {
  const generatedId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const drag = useRef<{ pointerId: number; y: number; height: number } | null>(null);
  const [height, setHeight] = useState<number>();
  const [size, setSize] = useState({ height: 0, minimum: 90 });
  const [dragging, setDragging] = useState(false);
  const fieldId = id ?? generatedId;
  useImperativeHandle(ref, () => field.current!, []);
  useLayoutEffect(() => {
    const element = field.current!;
    const measure = () => {
      const next = {
        height: Math.round(element.getBoundingClientRect().height),
        minimum: parseFloat(getComputedStyle(element).minHeight) || 90,
      };
      setSize((current) =>
        current.height === next.height && current.minimum === next.minimum ? current : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const maximum = Math.max(16384, size.minimum, size.height);
  const resize = (next: number) =>
    setHeight(Math.max(size.minimum, Math.min(maximum, Math.round(next))));
  const stop = () => {
    drag.current = null;
    setDragging(false);
  };
  return (
    <div className="ui-textarea-field">
      <textarea
        {...props}
        id={fieldId}
        ref={field}
        disabled={disabled}
        className={['ui-textarea', className].filter(Boolean).join(' ')}
        style={{ ...style, ...(height === undefined ? {} : { height }) }}
      />
      <Tooltip label="Изменить высоту поля">
        <div
          className="textarea-resize-handle"
          role="separator"
          tabIndex={disabled ? -1 : 0}
          aria-label="Изменить высоту поля"
          aria-controls={fieldId}
          aria-orientation="horizontal"
          aria-valuemin={size.minimum}
          aria-valuemax={maximum}
          aria-valuenow={size.height}
          aria-valuetext={`${size.height} пикселей`}
          aria-disabled={disabled || undefined}
          data-dragging={dragging || undefined}
          onPointerDown={(event) => {
            if (disabled || event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.focus({ preventScroll: true });
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = {
              pointerId: event.pointerId,
              y: event.clientY,
              height: field.current!.getBoundingClientRect().height,
            };
            setDragging(true);
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (start?.pointerId === event.pointerId)
              resize(start.height + event.clientY - start.y);
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
            stop();
          }}
          onPointerCancel={stop}
          onLostPointerCapture={stop}
          onKeyDown={(event) => {
            if (disabled) return;
            const current = field.current!.getBoundingClientRect().height;
            const next =
              event.key === 'ArrowDown'
                ? current + 20
                : event.key === 'ArrowUp'
                  ? current - 20
                  : event.key === 'Home'
                    ? size.minimum
                    : event.key === 'End'
                      ? maximum
                      : null;
            if (next !== null) {
              event.preventDefault();
              resize(next);
            }
          }}
        >
          <GripHorizontal size={16} aria-hidden="true" />
        </div>
      </Tooltip>
    </div>
  );
}
