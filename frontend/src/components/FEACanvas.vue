<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue';
import { useFEAStore } from '../store/fea';

const store = useFEAStore();
const canvas = ref<HTMLCanvasElement>();

let panX = 0;
let panY = 0;
let zoom = 1;
let isDragging = false;
let dragMoved = false;
let lastMouse = { x: 0, y: 0 };
let dragStart = { x: 0, y: 0 };

const MARGIN = 60;
const HIT_TOLERANCE = 15; // CSS pixels
const DRAG_THRESHOLD = 3; // CSS pixels

function modelBounds() {
  const { nodes } = store.model;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y);
  }
  return { minX, maxX, minY, maxY, worldW: maxX - minX || 1, worldH: maxY - minY || 1 };
}

// Single source of truth for the world→screen transform, shared by rendering
// and hit-testing so picked elements always match what is drawn. All offsets
// are in canvas-bitmap pixels.
function computeView() {
  const c = canvas.value;
  if (!c || store.model.nodes.length === 0) return null;
  const W = c.width;
  const H = c.height;
  const b = modelBounds();
  const fitScale = Math.min(
    (W - MARGIN * 2) / b.worldW,
    (H - MARGIN * 2) / b.worldH
  );
  const s = fitScale * zoom;
  const baseX = MARGIN - b.minX * s + (W - MARGIN * 2 - b.worldW * s) / 2;
  const baseY = MARGIN - b.minY * s + (H - MARGIN * 2 - b.worldH * s) / 2;
  return { s, baseX, baseY, ox: baseX + panX, oy: baseY + panY };
}

// Map a mouse/wheel event to canvas-bitmap pixel coordinates, accounting for
// the difference between the CSS display size and the canvas bitmap size.
function eventToCanvas(e: MouseEvent | WheelEvent): [number, number] {
  const c = canvas.value!;
  const rect = c.getBoundingClientRect();
  return [
    ((e.clientX - rect.left) / rect.width) * c.width,
    ((e.clientY - rect.top) / rect.height) * c.height,
  ];
}

function draw() {
  const ctx = canvas.value?.getContext('2d');
  if (!ctx) return;

  const W = canvas.value!.width;
  const H = canvas.value!.height;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, W, H);

  const { nodes, elements, loads } = store.model;
  if (nodes.length === 0) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('选择一个预设模型开始分析', W / 2, H / 2);
    return;
  }

  const view = computeView();
  if (!view) return;

  function toScreen(x: number, y: number): [number, number] {
    return [x * view.s + view.ox, y * view.s + view.oy];
  }

  // Draw elements with heatmap colors
  for (const el of elements) {
    const n1 = nodes.find((n) => n.id === el.nodeIds[0]);
    const n2 = nodes.find((n) => n.id === el.nodeIds[1]);
    if (!n1 || !n2) continue;

    const [x1, y1] = toScreen(n1.x, n1.y);
    const [x2, y2] = toScreen(n2.x, n2.y);
    const color = store.elementColors.get(el.id) || '#6b7280';
    const isSelected = store.selectedElement === el.id;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth = isSelected ? 4 : 2.5;
    ctx.stroke();

    if (isSelected) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Draw deformed mesh
  if (store.showDeformed && store.result) {
    ctx.setLineDash([5, 3]);
    for (const el of elements) {
      const n1 = nodes.find((n) => n.id === el.nodeIds[0]);
      const n2 = nodes.find((n) => n.id === el.nodeIds[1]);
      if (!n1 || !n2) continue;

      const s = store.deformationScale;
      const [x1, y1] = toScreen(n1.x + n1.displacementX * s, n1.y + n1.displacementY * s);
      const [x2, y2] = toScreen(n2.x + n2.displacementX * s, n2.y + n2.displacementY * s);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = 'rgba(251,191,36,0.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // Draw nodes
  for (const node of nodes) {
    const [x, y] = toScreen(node.x, node.y);

    if (node.fixed) {
      // Draw triangle for fixed nodes
      ctx.beginPath();
      ctx.moveTo(x, y - 8);
      ctx.lineTo(x - 6, y + 4);
      ctx.lineTo(x + 6, y + 4);
      ctx.closePath();
      ctx.fillStyle = '#f97316';
      ctx.fill();
      ctx.strokeStyle = '#ea580c';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Hatching below
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 1;
      for (let i = -8; i <= 8; i += 4) {
        ctx.beginPath();
        ctx.moveTo(x + i, y + 5);
        ctx.lineTo(x + i - 3, y + 10);
        ctx.stroke();
      }
    } else {
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#e2e8f0';
      ctx.fill();
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // Draw load arrows
  for (const load of loads) {
    const node = nodes.find((n) => n.id === load.nodeId);
    if (!node) continue;
    const [x, y] = toScreen(node.x, node.y);

    const mag = Math.sqrt(load.fx ** 2 + load.fy ** 2);
    if (mag === 0) continue;

    const arrowLen = 30;
    const dx = (load.fx / mag) * arrowLen;
    const dy = (load.fy / mag) * arrowLen;

    // Arrow line
    ctx.beginPath();
    ctx.moveTo(x - dx, y - dy);
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Arrow head
    const headLen = 8;
    const angle = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - headLen * Math.cos(angle - 0.4), y - headLen * Math.sin(angle - 0.4));
    ctx.moveTo(x, y);
    ctx.lineTo(x - headLen * Math.cos(angle + 0.4), y - headLen * Math.sin(angle + 0.4));
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Label
    ctx.fillStyle = '#fca5a5';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${(mag / 1000).toFixed(1)}kN`, x - dx / 2, y - dy / 2 - 6);
  }

  // Draw color legend bar
  const legendX = W - 40;
  const legendY = 30;
  const legendH = H - 60;
  const legendW = 15;

  const gradient = ctx.createLinearGradient(0, legendY, 0, legendY + legendH);
  gradient.addColorStop(0, 'rgb(255,0,0)');
  gradient.addColorStop(0.25, 'rgb(255,255,0)');
  gradient.addColorStop(0.5, 'rgb(0,255,0)');
  gradient.addColorStop(0.75, 'rgb(0,255,255)');
  gradient.addColorStop(1, 'rgb(0,0,128)');

  ctx.fillStyle = gradient;
  ctx.fillRect(legendX, legendY, legendW, legendH);
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 1;
  ctx.strokeRect(legendX, legendY, legendW, legendH);

  // Legend labels
  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';

  let maxVal = 0, minVal = 0;
  if (store.result) {
    switch (store.heatmapMode) {
      case 'stress':
        maxVal = Math.max(...store.result.stresses.map(Math.abs));
        break;
      case 'strain':
        maxVal = Math.max(...store.result.strains.map(Math.abs));
        break;
      case 'force':
        maxVal = Math.max(...elements.map((e) => Math.abs(e.force)));
        break;
    }
  }

  const unit = store.heatmapMode === 'stress' ? 'MPa' :
    store.heatmapMode === 'strain' ? '%' : 'kN';

  ctx.textAlign = 'right';
  ctx.fillText(`${maxVal.toExponential(1)} ${unit}`, legendX - 4, legendY + 8);
  ctx.fillText('0', legendX - 4, legendY + legendH);

  // Mode label
  ctx.save();
  ctx.translate(legendX + legendW + 10, legendY + legendH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#64748b';
  ctx.font = '11px sans-serif';
  ctx.fillText(store.heatmapMode.toUpperCase(), 0, 0);
  ctx.restore();
}

function handleMouseDown(e: MouseEvent) {
  isDragging = true;
  dragMoved = false;
  dragStart = { x: e.clientX, y: e.clientY };
  lastMouse = { x: e.clientX, y: e.clientY };
}

function handleMouseMove(e: MouseEvent) {
  if (!isDragging) return;

  // Convert CSS-pixel movement to bitmap-pixel movement so pan stays aligned
  // with the actual drawing regardless of the canvas display size.
  const c = canvas.value!;
  const rect = c.getBoundingClientRect();
  const scaleX = c.width / rect.width;
  const scaleY = c.height / rect.height;
  const dx = (e.clientX - lastMouse.x) * scaleX;
  const dy = (e.clientY - lastMouse.y) * scaleY;

  if (
    !dragMoved &&
    Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y) >= DRAG_THRESHOLD
  ) {
    dragMoved = true;
  }

  panX += dx;
  panY += dy;
  lastMouse = { x: e.clientX, y: e.clientY };
  draw();
}

function handleMouseUp() {
  isDragging = false;
}

function handleWheel(e: WheelEvent) {
  e.preventDefault();
  if (store.model.nodes.length === 0) return;

  const factor = e.deltaY > 0 ? 0.9 : 1.1;
  const newZoom = Math.max(0.1, Math.min(10, zoom * factor));

  // Zoom around the cursor: keep the world point under the cursor stationary
  // by adjusting pan to compensate.
  const view = computeView();
  if (view) {
    const [cx, cy] = eventToCanvas(e);
    panX = cx - (newZoom / zoom) * (cx - view.ox) - view.baseX;
    panY = cy - (newZoom / zoom) * (cy - view.oy) - view.baseY;
  }
  zoom = newZoom;
  draw();
}

function handleClick(e: MouseEvent) {
  // A mouseup after a drag fires click too — panning must never change the
  // selection, neither mid-drag nor on release.
  if (dragMoved || store.model.nodes.length === 0) return;

  const view = computeView();
  if (!view) return;

  const [mx, my] = eventToCanvas(e);

  const { nodes, elements } = store.model;

  // Tolerance specified in CSS pixels so it feels identical at any display size.
  const c = canvas.value!;
  const rect = c.getBoundingClientRect();
  const bestDist = HIT_TOLERANCE * (c.width / rect.width);
  let bestId: number | null = null;

  for (const el of elements) {
    const n1 = nodes.find((n) => n.id === el.nodeIds[0]);
    const n2 = nodes.find((n) => n.id === el.nodeIds[1]);
    if (!n1 || !n2) continue;

    const x1 = n1.x * view.s + view.ox;
    const y1 = n1.y * view.s + view.oy;
    const x2 = n2.x * view.s + view.ox;
    const y2 = n2.y * view.s + view.oy;

    // Point-to-segment distance
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) continue;
    let t = ((mx - x1) * dx + (my - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = x1 + t * dx;
    const py = y1 + t * dy;
    const dist = Math.sqrt((mx - px) ** 2 + (my - py) ** 2);

    if (dist < bestDist) {
      bestId = el.id;
    }
  }

  // A real click on an element toggles it; clicking empty space near nothing
  // leaves the current selection untouched.
  if (bestId !== null) {
    store.selectElement(store.selectedElement === bestId ? null : bestId);
  }
  draw();
}

onMounted(() => {
  nextTick(draw);
});

// Reset view when a different model is loaded (reference replaced).
watch(
  () => store.model,
  () => {
    panX = 0;
    panY = 0;
    zoom = 1;
    nextTick(draw);
  }
);

watch(
  () => [
    store.model,
    store.result,
    store.showDeformed,
    store.deformationScale,
    store.selectedElement,
    store.heatmapMode,
    store.elementColors,
  ],
  () => nextTick(draw),
  { deep: true }
);
</script>

<template>
  <canvas
    ref="canvas"
    width="800"
    height="500"
    class="w-full rounded-lg border border-slate-700"
    :class="isDragging ? 'cursor-grabbing' : 'cursor-grab'"
    @mousedown="handleMouseDown"
    @mousemove="handleMouseMove"
    @mouseup="handleMouseUp"
    @mouseleave="handleMouseUp"
    @wheel="handleWheel"
    @click="handleClick"
  />
</template>
