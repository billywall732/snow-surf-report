// Tiny inline-SVG chart helpers — no chart library.
// One function, timeChart(), draws both the snow-depth line and the tide curve.
//
// How an SVG chart works: we pick a pixel box (width × height), then use two
// "scale" functions to turn data values into pixel positions:
//   sx(time)  -> how far from the left
//   sy(value) -> how far from the top (SVG's y axis points DOWN, so big values get small y)

const NS = 'http://www.w3.org/2000/svg';

// Create an SVG element: svg('circle', { cx: 5, cy: 5, r: 4 })
export function svg(tag, attrs = {}, text) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text != null) el.textContent = text; // textContent never runs HTML — safe for any data
  return el;
}

// "Nice" axis ticks: steps of 1, 2 or 5 × a power of ten.
function niceTicks(min, max, count = 4) {
  const raw = (max - min) / count || 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw);
  const ticks = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.001; v += step) {
    ticks.push(Math.round(v * 100) / 100);
  }
  return ticks;
}

/**
 * Draw a single-series line chart over time into `container`.
 * opts = {
 *   title:    text description for screen readers (the chart's "alt text")
 *   points:   [{ x: epochMs, y: number }]
 *   xDomain:  [startMs, endMs]
 *   xTicks:   [{ x: epochMs, label }]
 *   yMin, yMinSpan: lowest y value / smallest y range to show
 *   unit:     appended to y labels, e.g. '"' or ' ft'
 *   area:     true to shade under the line
 *   markers:  [{ x, y, label, below }]  labelled dots (tide highs and lows)
 *   endLabel: true to label the last value
 *   nowX:     epochMs for a "Now" line, or null
 *   tooltip:  (point) => string shown on hover
 *   height:   pixels (default 150)
 * }
 */
export function timeChart(container, opts) {
  container.replaceChildren();
  const width = Math.max(260, container.clientWidth);
  const height = opts.height ?? 150;
  const hasMarkers = Boolean(opts.markers?.length);
  const m = { top: hasMarkers ? 32 : 22, right: opts.endLabel ? 40 : 14, bottom: 24, left: 34 };

  const ys = opts.points.map((p) => p.y);
  const yLo = Math.min(opts.yMin ?? Infinity, ...ys);
  // Leave ~15% headroom above the highest point when there are labels to fit up there.
  const yHi = Math.max(yLo + (opts.yMinSpan ?? 1), ...ys) * (hasMarkers ? 1.15 : 1);
  const yTicks = niceTicks(yLo, yHi, 3);
  const [y0, y1] = [yTicks[0], yTicks.at(-1)];
  const [x0, x1] = opts.xDomain;

  const sx = (x) => m.left + ((x - x0) / (x1 - x0)) * (width - m.left - m.right);
  const sy = (y) => m.top + (1 - (y - y0) / (y1 - y0 || 1)) * (height - m.top - m.bottom);

  const root = svg('svg', {
    width, height, viewBox: `0 0 ${width} ${height}`,
    role: 'img', 'aria-label': opts.title, class: 'chart',
  });

  // Gridlines + y labels (recessive: thin and gray)
  for (const t of yTicks) {
    root.append(svg('line', { x1: m.left, x2: width - m.right, y1: sy(t), y2: sy(t), class: t === y0 ? 'axis' : 'grid' }));
    root.append(svg('text', { x: m.left - 6, y: sy(t) + 4, 'text-anchor': 'end', class: 'tick' }, `${t}${opts.unit ?? ''}`));
  }
  // X labels
  for (const t of opts.xTicks) {
    root.append(svg('text', { x: sx(t.x), y: height - 6, 'text-anchor': 'middle', class: 'tick' }, t.label));
  }

  // The data: shaded area, then the 2px line on top
  const pts = opts.points.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`);
  if (opts.area) {
    root.append(svg('path', {
      d: `M${sx(opts.points[0].x)},${sy(y0)} L${pts.join(' L')} L${sx(opts.points.at(-1).x)},${sy(y0)} Z`,
      class: 'area',
    }));
  }
  root.append(svg('path', { d: `M${pts.join(' L')}`, class: 'line' }));

  // "Now" marker
  if (opts.nowX != null && opts.nowX >= x0 && opts.nowX <= x1) {
    root.append(svg('line', { x1: sx(opts.nowX), x2: sx(opts.nowX), y1: m.top - 6, y2: height - m.bottom, class: 'now' }));
    root.append(svg('text', { x: sx(opts.nowX), y: m.top - 10, 'text-anchor': 'middle', class: 'tick now-label' }, 'Now'));
  }

  // Labelled markers (e.g. high and low tide)
  for (const mk of opts.markers ?? []) {
    const cx = sx(mk.x);
    const cy = sy(mk.y);
    const anchor = cx < m.left + 30 ? 'start' : cx > width - m.right - 30 ? 'end' : 'middle';
    root.append(svg('circle', { cx, cy, r: 4, class: 'dot' }));
    root.append(svg('text', { x: cx, y: mk.below ? cy + 16 : cy - 9, 'text-anchor': anchor, class: 'mark-label' }, mk.label));
  }

  // End label: the latest value, next to the last point
  if (opts.endLabel) {
    const last = opts.points.at(-1);
    root.append(svg('circle', { cx: sx(last.x), cy: sy(last.y), r: 4, class: 'dot' }));
    root.append(svg('text', { x: sx(last.x) + 8, y: sy(last.y) + 4, class: 'mark-label' }, `${last.y}${opts.unit ?? ''}`));
  }

  // Hover layer: a vertical crosshair snaps to the nearest point, with a tooltip.
  const cross = svg('line', { y1: m.top, y2: height - m.bottom, class: 'crosshair', visibility: 'hidden' });
  const hoverDot = svg('circle', { r: 4, class: 'dot', visibility: 'hidden' });
  const hit = svg('rect', { x: m.left, y: 0, width: width - m.left - m.right, height, fill: 'transparent' });
  root.append(cross, hoverDot, hit);

  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.hidden = true;

  hit.addEventListener('pointermove', (e) => {
    const box = root.getBoundingClientRect();
    const px = e.clientX - box.left;
    let best = opts.points[0];
    for (const p of opts.points) if (Math.abs(sx(p.x) - px) < Math.abs(sx(best.x) - px)) best = p;
    const cx = sx(best.x);
    cross.setAttribute('x1', cx);
    cross.setAttribute('x2', cx);
    hoverDot.setAttribute('cx', cx);
    hoverDot.setAttribute('cy', sy(best.y));
    cross.setAttribute('visibility', 'visible');
    hoverDot.setAttribute('visibility', 'visible');
    tip.textContent = opts.tooltip(best);
    tip.hidden = false;
    // Keep the tooltip inside the chart's box
    tip.style.left = `${Math.min(Math.max(cx - tip.offsetWidth / 2, 0), width - tip.offsetWidth)}px`;
  });
  hit.addEventListener('pointerleave', () => {
    cross.setAttribute('visibility', 'hidden');
    hoverDot.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  });

  container.append(root, tip);
}

// The 5-segment rating bar (red -> green). The number is always printed next
// to it too, so the rating never depends on seeing color.
export function ratingBar(score) {
  const root = svg('svg', { width: 90, height: 10, viewBox: '0 0 90 10', 'aria-hidden': 'true', class: 'rating-bar' });
  for (let i = 0; i < 5; i++) {
    root.append(svg('rect', {
      x: i * 18, y: 0, width: 16, height: 10, rx: 2, // 16px segment + 2px gap
      class: score != null && i < score ? `seg seg-${i + 1}` : 'seg seg-off',
    }));
  }
  return root;
}
