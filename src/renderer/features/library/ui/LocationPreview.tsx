import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Maximize, ZoomIn, ZoomOut } from 'lucide-react';
import { IconButton } from '@/shared/ui';
import { clampCamera, type CameraPosition } from '../model/camera';

export function LocationPreview({ src, title }: { src: string; title: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; camera: CameraPosition } | null>(
    null,
  );
  const [camera, setCamera] = useState<CameraPosition>({ zoom: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const constrain = (next: CameraPosition) =>
    clampCamera(
      next,
      { width: viewport.current?.clientWidth ?? 0, height: viewport.current?.clientHeight ?? 0 },
      { width: image.current?.naturalWidth ?? 0, height: image.current?.naturalHeight ?? 0 },
    );

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      setCamera((previous) =>
        clampCamera(
          previous,
          { width: element.clientWidth, height: element.clientHeight },
          { width: image.current?.naturalWidth ?? 0, height: image.current?.naturalHeight ?? 0 },
        ),
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointer !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const zoom = (value: number) => setCamera((previous) => constrain({ ...previous, zoom: value }));
  return (
    <div className="location-preview">
      <div
        className="location-camera"
        ref={viewport}
        data-zoomed={camera.zoom > 1 || undefined}
        data-dragging={dragging || undefined}
        tabIndex={0}
        role="group"
        aria-label={`Камера локации: ${title}`}
        aria-describedby="camera-help"
        onPointerDown={(event) => {
          if (camera.zoom <= 1 || event.button !== 0) return;
          event.preventDefault();
          drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, camera };
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (start?.pointer === event.pointerId)
            setCamera(
              constrain({
                ...start.camera,
                x: start.camera.x + event.clientX - start.x,
                y: start.camera.y + event.clientY - start.y,
              }),
            );
        }}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onLostPointerCapture={() => {
          drag.current = null;
          setDragging(false);
        }}
        onKeyDown={(event) => {
          const directions: Record<string, [number, number]> = {
            ArrowLeft: [30, 0],
            ArrowRight: [-30, 0],
            ArrowUp: [0, 30],
            ArrowDown: [0, -30],
          };
          const move = directions[event.key];
          if (move && camera.zoom > 1) {
            event.preventDefault();
            setCamera(constrain({ ...camera, x: camera.x + move[0], y: camera.y + move[1] }));
          }
        }}
      >
        <img
          ref={image}
          src={src}
          alt={title}
          draggable={false}
          style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}
        />
      </div>
      <div className="camera-toolbar">
        <IconButton
          title="Уменьшить камеру"
          disabled={camera.zoom <= 1}
          onClick={() => zoom(camera.zoom - 0.25)}
        >
          <ZoomOut size={19} />
        </IconButton>
        <label className="camera-zoom">
          <span>Масштаб</span>
          <input
            aria-label="Масштаб камеры"
            type="range"
            min="1"
            max="4"
            step="0.05"
            value={camera.zoom}
            onChange={(event) => zoom(Number(event.target.value))}
          />
          <output>{Math.round(camera.zoom * 100)}%</output>
        </label>
        <IconButton
          title="Увеличить камеру"
          disabled={camera.zoom >= 4}
          onClick={() => zoom(camera.zoom + 0.25)}
        >
          <ZoomIn size={19} />
        </IconButton>
        <IconButton title="Сбросить камеру" onClick={() => setCamera({ zoom: 1, x: 0, y: 0 })}>
          <Maximize size={19} />
        </IconButton>
      </div>
      <p className="subtle" id="camera-help">
        При увеличении перетащите изображение или используйте стрелки клавиатуры.
      </p>
    </div>
  );
}
