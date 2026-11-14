export interface CameraPosition {
  zoom: number;
  x: number;
  y: number;
}

export function clampCamera(
  camera: CameraPosition,
  viewport: { width: number; height: number },
  image: { width: number; height: number },
): CameraPosition {
  const zoom = Math.min(4, Math.max(1, camera.zoom));
  const fit =
    image.width && image.height
      ? Math.min(viewport.width / image.width, viewport.height / image.height)
      : 1;
  const maxX = Math.max(0, (image.width * fit * zoom - viewport.width) / 2);
  const maxY = Math.max(0, (image.height * fit * zoom - viewport.height) / 2);
  return {
    zoom,
    x: maxX === 0 ? 0 : Math.max(-maxX, Math.min(maxX, camera.x)),
    y: maxY === 0 ? 0 : Math.max(-maxY, Math.min(maxY, camera.y)),
  };
}
