import type { TrailObstacle } from "./terrain-trail-motion";

export function measureTerrainBounds(
  canvas: HTMLCanvasElement,
  frameHeight: number,
): TrailObstacle {
  const rect = canvas.getBoundingClientRect();
  const bounds = {
    left: Math.max(0, -rect.left),
    top: Math.max(0, -rect.top),
    right: Math.min(rect.width, window.innerWidth - rect.left),
    bottom: Math.min(frameHeight, window.innerHeight - rect.top),
  };
  for (let parent = canvas.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    const clipX = ["hidden", "clip", "scroll", "auto"].includes(style.overflowX);
    const clipY = ["hidden", "clip", "scroll", "auto"].includes(style.overflowY);
    if (!clipX && !clipY) continue;
    const box = parent.getBoundingClientRect();
    if (clipX) {
      bounds.left = Math.max(bounds.left, box.left + parent.clientLeft - rect.left);
      bounds.right = Math.min(
        bounds.right,
        box.left + parent.clientLeft + parent.clientWidth - rect.left,
      );
    }
    if (clipY) {
      bounds.top = Math.max(bounds.top, box.top + parent.clientTop - rect.top);
      bounds.bottom = Math.min(
        bounds.bottom,
        box.top + parent.clientTop + parent.clientHeight - rect.top,
      );
    }
  }
  return bounds;
}
