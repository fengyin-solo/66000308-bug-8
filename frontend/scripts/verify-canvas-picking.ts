/**
 * Verification for canvas point-selection (FEACanvas.vue).
 *
 * Exercises the exact functions the component uses (src/utils/canvas-view.ts)
 * across presets × display sizes × zoom levels × pan offsets:
 *
 *   1. 逐根点选: clicking each element's drawn midpoint selects exactly it,
 *      whatever the CSS display size (wider/equal/narrower than the bitmap).
 *   2. 取消选中: clicking empty space yields null (deselect).
 *   3. 拖动保护: press-drag-release never changes the selection, even when
 *      the release point sits on another element; pan deltas convert correctly.
 *   4. 一一对应: every picked id resolves to a real element, so the highlight
 *      (selectedElement === el.id) and the details panel (单元 #id) agree.
 *
 * Run: npm run verify:picking
 */
import {
  computeViewTransform,
  cssToCanvasPos,
  isClickGesture,
  pickElement,
  worldToCanvas,
  CLICK_TOLERANCE_PX,
} from '../src/utils/canvas-view';
import {
  presetCantileverBeam,
  presetBridgeTruss,
  presetSimpleFrame,
  solve,
} from '../src/utils/fea-solver';
import type { FEAModel } from '../src/types';

const CANVAS_W = 800; // <canvas width="800" height="500">
const CANVAS_H = 500;

let checks = 0;
let failures = 0;

function expect(cond: boolean, label: string) {
  checks++;
  if (!cond) {
    failures++;
    console.error(`  ✗ FAIL: ${label}`);
  }
}

// ─── Browser simulation helpers ─────────────────────────────────────────────
// Where the browser would report a click that lands on bitmap point (bx, by)
// when the canvas is displayed at dispW x dispH CSS px.
function bitmapToClientCss(
  bx: number,
  by: number,
  dispW: number,
  dispH: number
): [number, number] {
  return [(bx / CANVAS_W) * dispW, (by / CANVAS_H) * dispH];
}

// Mirrors FEACanvas.handleClick: returns the new selection given a
// mousedown/mouseup pair in CSS px relative to the canvas element.
function emulateClick(
  model: FEAModel,
  dispW: number,
  dispH: number,
  zoom: number,
  pan: [number, number],
  downCss: [number, number],
  upCss: [number, number],
  currentSelection: number | null
): number | null {
  if (!isClickGesture(downCss[0], downCss[1], upCss[0], upCss[1])) {
    return currentSelection; // drag: selection untouched
  }
  const [mx, my] = cssToCanvasPos(upCss[0], upCss[1], dispW, dispH, CANVAS_W, CANVAS_H);
  const t = computeViewTransform(model.nodes, CANVAS_W, CANVAS_H, zoom, pan[0], pan[1]);
  return pickElement(model.nodes, model.elements, mx, my, t);
}

// Mirrors FEACanvas.handleMouseMove: a CSS-px drag delta pans the view.
function emulateDragPan(
  pan: [number, number],
  dxCss: number,
  dyCss: number,
  dispW: number,
  dispH: number
): [number, number] {
  return [
    pan[0] + (dxCss / dispW) * CANVAS_W,
    pan[1] + (dyCss / dispH) * CANVAS_H,
  ];
}

function elementMidpointBitmap(
  model: FEAModel,
  elId: number,
  t: ReturnType<typeof computeViewTransform>
): [number, number] {
  const el = model.elements.find((e) => e.id === elId)!;
  const n1 = model.nodes.find((n) => n.id === el.nodeIds[0])!;
  const n2 = model.nodes.find((n) => n.id === el.nodeIds[1])!;
  const [x1, y1] = worldToCanvas(n1.x, n1.y, t);
  const [x2, y2] = worldToCanvas(n2.x, n2.y, t);
  return [(x1 + x2) / 2, (y1 + y2) / 2];
}

const onCanvas = (bx: number, by: number) =>
  bx >= 2 && bx <= CANVAS_W - 2 && by >= 2 && by <= CANVAS_H - 2;

// ─── Test matrix ────────────────────────────────────────────────────────────
const presets: [string, () => FEAModel][] = [
  ['cantilever', presetCantileverBeam],
  ['bridge', presetBridgeTruss],
  ['frame', presetSimpleFrame],
];

const displays: [string, number, number][] = [
  ['equal 800x500', 800, 500],
  ['wider 1100x687.5', 1100, 687.5],
  ['narrower 600x375', 600, 375],
  ['stretched 1000x400', 1000, 400], // robustness: non-uniform CSS scaling
];

const zooms = [0.5, 1, 2.5];
const pans: [number, number][] = [
  [0, 0],
  [80, -40],
  [-120, 60],
];

for (const [presetName, makeModel] of presets) {
  const model = makeModel();
  solve(model); // "开始分析" — results must not disturb picking geometry
  console.log(`\n■ ${presetName}: ${model.elements.length} elements (after solve)`);

  const hitSomewhere = new Set<number>(); // every element must be clickable in >= 1 config

  for (const [dispLabel, dispW, dispH] of displays) {
    for (const zoom of zooms) {
      for (const pan of pans) {
        const ctx = `${presetName} | ${dispLabel} | zoom=${zoom} | pan=${pan}`;
        const t = computeViewTransform(model.nodes, CANVAS_W, CANVAS_H, zoom, pan[0], pan[1]);

        // 1) 逐根点选: click each element's drawn midpoint -> selects exactly it
        let clickable = 0;
        for (const el of model.elements) {
          const [bx, by] = elementMidpointBitmap(model, el.id, t);
          if (!onCanvas(bx, by)) continue; // off-screen in this zoom/pan config
          clickable++;
          const css = bitmapToClientCss(bx, by, dispW, dispH);
          const sel = emulateClick(model, dispW, dispH, zoom, pan, css, css, null);
          expect(sel === el.id, `${ctx} | click el#${el.id} -> got ${sel}`);
          if (sel === el.id) hitSomewhere.add(el.id);
          // 一一对应: picked id must resolve to a real element for the details panel
          if (sel !== null) {
            expect(
              model.elements.some((e) => e.id === sel),
              `${ctx} | picked id ${sel} resolves in model`
            );
          }
        }
        expect(clickable > 0, `${ctx} | at least one element on-screen`);

        // 2) 取消选中: clicking empty space -> null
        let emptyTested = 0;
        for (let gx = 5; gx < CANVAS_W - 5 && emptyTested < 5; gx += 37) {
          for (let gy = 5; gy < CANVAS_H - 5 && emptyTested < 5; gy += 41) {
            if (pickElement(model.nodes, model.elements, gx, gy, t) !== null) continue;
            const css = bitmapToClientCss(gx, gy, dispW, dispH);
            const sel = emulateClick(model, dispW, dispH, zoom, pan, css, css, 0);
            expect(sel === null, `${ctx} | click empty (${gx},${gy}) deselects`);
            emptyTested++;
          }
        }
        expect(emptyTested > 0, `${ctx} | empty space exists to click`);
      }
    }
  }

  // Every single element must be selectable in at least one view configuration
  for (const el of model.elements) {
    expect(hitSomewhere.has(el.id), `${presetName} | el#${el.id} selectable in some config`);
  }

  // ─── 3) Drag / zoom combination session (mirrors the reported bug) ────────
  const dispW = 1100, dispH = 687.5; // container wider than the canvas bitmap
  let zoom = 1;
  let pan: [number, number] = [0, 0];
  let sel: number | null = null;
  const t0 = () => computeViewTransform(model.nodes, CANVAS_W, CANVAS_H, zoom, pan[0], pan[1]);
  const cssOf = (elId: number): [number, number] => {
    const [bx, by] = elementMidpointBitmap(model, elId, t0());
    return bitmapToClientCss(bx, by, dispW, dispH);
  };

  const elA = model.elements[0].id;
  const elB = model.elements[model.elements.length - 1].id;

  // Select A with a genuine click
  sel = emulateClick(model, dispW, dispH, zoom, pan, cssOf(elA), cssOf(elA), sel);
  expect(sel === elA, `${presetName} session | click selects el#${elA}`);

  // Press-drag-release ending exactly on B: selection must stay on A
  const downAt = cssOf(elA);
  pan = emulateDragPan(pan, 137.5, -68.75, dispW, dispH); // drag 137.5 CSS px right, 68.75 up
  const upAt: [number, number] = [downAt[0] + 137.5, downAt[1] - 68.75];
  sel = emulateClick(model, dispW, dispH, zoom, pan, downAt, upAt, sel);
  expect(sel === elA, `${presetName} session | drag-release does not change selection`);

  // The drag above must have panned by exactly (100, -50) bitmap px
  expect(
    Math.abs(pan[0] - 100) < 1e-9 && Math.abs(pan[1] + 50) < 1e-9,
    `${presetName} session | CSS->bitmap pan conversion (got ${pan})`
  );

  // After panning, clicking B's NEW drawn position selects B
  sel = emulateClick(model, dispW, dispH, zoom, pan, cssOf(elB), cssOf(elB), sel);
  expect(sel === elB, `${presetName} session | post-pan click selects el#${elB}`);

  // Zoom in (wheel x3) then drag again; selection survives both, then re-pick
  zoom *= 1.1 * 1.1 * 1.1;
  const down2 = cssOf(elB);
  pan = emulateDragPan(pan, -55, 27.5, dispW, dispH);
  const up2: [number, number] = [down2[0] - 55, down2[1] + 27.5];
  sel = emulateClick(model, dispW, dispH, zoom, pan, down2, up2, sel);
  expect(sel === elB, `${presetName} session | zoom+drag keeps selection`);
  sel = emulateClick(model, dispW, dispH, zoom, pan, cssOf(elA), cssOf(elA), sel);
  expect(sel === elA, `${presetName} session | post zoom+drag click selects el#${elA}`);

  // Sub-threshold wobble (<= CLICK_TOLERANCE_PX) is still a click, not a pan
  const c = cssOf(elB);
  const wobble: [number, number] = [c[0] + CLICK_TOLERANCE_PX - 1, c[1]];
  sel = emulateClick(model, dispW, dispH, zoom, pan, c, wobble, null);
  expect(sel === elB, `${presetName} session | sub-threshold wobble still selects`);

  // ─── 4) Regression probe: the pre-fix math (CSS px used as bitmap px) ─────
  // Proves this matrix is sensitive to the original bug.
  const tWide = computeViewTransform(model.nodes, CANVAS_W, CANVAS_H, 1, 0, 0);
  let mismatches = 0;
  for (const el of model.elements) {
    const [bx, by] = elementMidpointBitmap(model, el.id, tWide);
    if (!onCanvas(bx, by)) continue;
    const [cssX, cssY] = bitmapToClientCss(bx, by, dispW, dispH);
    // Old handler skipped cssToCanvasPos and used CSS px directly:
    if (pickElement(model.nodes, model.elements, cssX, cssY, tWide) !== el.id) mismatches++;
  }
  console.log(
    `  (regression probe: pre-fix math mis-picks ${mismatches}/${model.elements.length} elements at 1100px display)`
  );
  expect(mismatches > 0, `${presetName} | matrix is sensitive to the old CSS/bitmap bug`);
}

console.log(`\n${failures === 0 ? '✓ ALL PASSED' : '✗ FAILURES'}: ${checks - failures}/${checks} checks`);
if (failures > 0) {
  throw new Error(`${failures} picking check(s) failed`);
}
