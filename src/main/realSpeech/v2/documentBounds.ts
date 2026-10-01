export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function readableBounds(
  saved: Bounds | undefined,
  areas: Bounds[],
  primary: Bounds,
): Bounds {
  const area =
    (saved &&
      areas.find(
        (a) =>
          saved.x < a.x + a.width &&
          saved.x + saved.width > a.x &&
          saved.y < a.y + a.height &&
          saved.y + saved.height > a.y,
      )) ||
    primary;
  const width = Math.min(
      area.width,
      Math.max(320, saved?.width || Math.round(area.width * 0.7)),
    ),
    height = Math.min(
      area.height,
      Math.max(240, saved?.height || Math.round(area.height * 0.7)),
    );
  return {
    width,
    height,
    x: Math.max(
      area.x,
      Math.min(
        area.x + area.width - width,
        saved?.x ?? area.x + Math.round((area.width - width) / 2),
      ),
    ),
    y: Math.max(
      area.y,
      Math.min(
        area.y + area.height - height,
        saved?.y ?? area.y + Math.round((area.height - height) / 2),
      ),
    ),
  };
}
