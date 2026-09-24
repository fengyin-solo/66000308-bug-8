import type { Element, Node } from '../types';

// A press-release within this many CSS px is a click; anything beyond is a pan drag.
export const CLICK_TOLERANCE_PX = 5;

// True while the pointer has stayed close enough to the mousedown point for
// the gesture to count as a click rather than a pan.
export function isClickGesture(
  downX: number,
  downY: number,
  upX: number,
  upY: number
): boolean {
  return Math.hypot(upX - downX, upY - downY) <= CLICK_TOLERANCE_PX;
}

export interface ViewTransform {
  drawScale: number;
  drawOffsetX: number;
  drawOffsetY: number;
}

// Auto-fit + manual zoom/pan transform from world coords to canvas bitmap px.
// Single source of truth shared by rendering and click hit-testing, so what
// you see is always what you click.
export function computeViewTransform(
  nodes: Node[],
  canvasW: number,
  canvasH: number,
  zoom: number,
  panX: number,
  panY: number
): ViewTransform {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y);
  }
  const worldW = maxX - minX || 1;
  const worldH = maxY - minY || 1;
  const margin = 60;
  const fitScale = Math.min((canvasW - margin * 2) / worldW, (canvasH - margin * 2) / worldH);

  const drawScale = fitScale * zoom;
  const drawOffsetX =
    margin - minX * drawScale + (canvasW - margin * 2 - worldW * drawScale) / 2 + panX;
  const drawOffsetY =
    margin - minY * drawScale + (canvasH - margin * 2 - worldH * drawScale) / 2 + panY;
  return { drawScale, drawOffsetX, drawOffsetY };
}

export function worldToCanvas(x: number, y: number, t: ViewTransform): [number, number] {
  return [x * t.drawScale + t.drawOffsetX, y * t.drawScale + t.drawOffsetY];
}

// Mouse events are delivered in CSS px of the *displayed* element, while
// drawing happens in bitmap px (canvas.width/height). The two differ whenever
// CSS scales the canvas (e.g. w-full in a wider/narrower container), so
// convert before hit-testing.
export function cssToCanvasPos(
  cssX: number,
  cssY: number,
  displayW: number,
  displayH: number,
  canvasW: number,
  canvasH: number
): [number, number] {
  return [(cssX / displayW) * canvasW, (cssY / displayH) * canvasH];
}

// Nearest element to a point (canvas bitmap px), within `tolerance` px;
// null when the click landed on empty space (i.e. deselect).
export function pickElement(
  nodes: Node[],
  elements: Element[],
  mx: number,
  my: number,
  t: ViewTransform,
  tolerance = 15
): number | null {
  let bestDist = tolerance;
  let bestId: number | null = null;

  for (const el of elements) {
    const n1 = nodes.find((n) => n.id === el.nodeIds[0]);
    const n2 = nodes.find((n) => n.id === el.nodeIds[1]);
    if (!n1 || !n2) continue;

    const [x1, y1] = worldToCanvas(n1.x, n1.y, t);
    const [x2, y2] = worldToCanvas(n2.x, n2.y, t);

    // Point-to-segment distance
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) continue;
    let s = ((mx - x1) * dx + (my - y1) * dy) / len2;
    s = Math.max(0, Math.min(1, s));
    const px = x1 + s * dx;
    const py = y1 + s * dy;
    const dist = Math.hypot(mx - px, my - py);

    if (dist < bestDist) {
      bestDist = dist;
      bestId = el.id;
    }
  }
  return bestId;
}
