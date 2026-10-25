// The resort map: a US outline with a dot for every mountain. No map library.
//
// A "projection" turns latitude/longitude on the round Earth into x/y on a flat
// picture. The outline in us-map-data.js was drawn with the "Albers USA"
// projection (the one most US maps use: lower 48 in the middle, Alaska shrunk
// into a box at the bottom left), so the dots must use the exact same math.
import { NATION, STATE_BORDERS, VIEWBOX } from './us-map-data.js';
import { svg } from './charts.js';
import { h as el } from './ui.js'; // (named 'el' here: inside createMap, h means the map's height)

const RAD = Math.PI / 180;

// Albers equal-area conic: the core formula for one map region.
function conicEqualArea({ parallels: [p0, p1], rotate, center, scale, translate }) {
  const sy0 = Math.sin(p0 * RAD);
  const n = (sy0 + Math.sin(p1 * RAD)) / 2;
  const c = 1 + sy0 * (2 * n - sy0);
  const r0 = Math.sqrt(c) / n;
  const raw = (lambda, phi) => {
    const r = Math.sqrt(c - 2 * n * Math.sin(phi)) / n;
    return [r * Math.sin(lambda * n), r0 - r * Math.cos(lambda * n)];
  };
  const [cx, cy] = raw(center[0] * RAD, center[1] * RAD);
  return (lon, lat) => {
    let lambda = (lon + rotate) * RAD;
    if (lambda > Math.PI) lambda -= 2 * Math.PI; // keep longitude within -180..180
    if (lambda < -Math.PI) lambda += 2 * Math.PI;
    const [x, y] = raw(lambda, lat * RAD);
    return [translate[0] + scale * (x - cx), translate[1] - scale * (y - cy)];
  };
}

// The same settings us-atlas used (d3.geoAlbersUsa().scale(1300).translate([487.5, 305])).
const K = 1300;
const [TX, TY] = [487.5, 305];
const lower48 = conicEqualArea({ parallels: [29.5, 45.5], rotate: 96, center: [-0.6, 38.7], scale: K, translate: [TX, TY] });
const alaska = conicEqualArea({ parallels: [55, 65], rotate: 154, center: [-2, 58.5], scale: K * 0.35, translate: [TX - 0.307 * K, TY + 0.201 * K] });
const hawaii = conicEqualArea({ parallels: [8, 18], rotate: 157, center: [-3, 19.9], scale: K, translate: [TX - 0.205 * K, TY + 0.212 * K] });

export function project(lat, lon) {
  if (lat > 50 && lon < -129) return alaska(lon, lat);
  if (lat < 25 && lon < -150) return hawaii(lon, lat);
  return lower48(lon, lat);
}

/**
 * Build the map once and return an object with update(), which changes only what's
 * needed (colors, sizes, labels, fading). Rebuilding the whole map — a big outline
 * plus 50–80 icons — on every keystroke or pin change was the slowest part of the page.
 *
 * createMap(container, { items, icon, label, width, onSelect, classFor })
 *   items:    report items (each has id, name, lat, lon, rating)
 *   icon:     'peak' (mountains) or 'wave' (beaches)
 *   label:    what the map shows, for screen readers
 *   width:    the container's width in pixels (measured by the caller)
 *   onSelect: called with an id when an icon is clicked or activated by keyboard
 *   classFor: optional (item) => extra CSS classes, e.g. 'pass-ikon' for coloring
 * map.update({ pinned, selected, visible })
 *   pinned:   Set of pinned ids (larger, outlined, name label)
 *   selected: id open in the detail view (highlighted), or null
 *   visible:  Set of ids matching the list filter (others are faded)
 *
 * Zooming: + / − / reset buttons, pinch on a phone, double-click or Ctrl + scroll
 * on a computer, and drag to move around once zoomed in. Zoom works by showing a
 * smaller part of the map (the SVG "viewBox"); each place's icon and label sit in a
 * group that's scaled down by the same amount, so they stay the same size on screen
 * and crowded areas spread out as you zoom in.
 */
const MAX_ZOOM = 8;

export function createMap(container, { items, icon = 'peak', label: mapLabel = 'places', width, onSelect, classFor }) {
  const [w, h] = VIEWBOX;
  // The map is drawn in a 975-wide coordinate box and then shrunk or stretched to
  // fit the screen. k converts 'real screen pixels' into map units, so icons, labels
  // and tap targets stay the same on-screen size on a phone and on a desktop.
  const k = w / Math.max(280, width || w);
  const root = svg('svg', {
    viewBox: `0 0 ${w} ${h}`,
    class: 'us-map',
    style: `--k: ${k.toFixed(3)}`,
    role: 'group',
    'aria-label': `Map of US ${mapLabel}. Pinned ones are larger and outlined. Use the zoom buttons to zoom in.`,
  });
  root.append(
    svg('path', { d: NATION, class: 'map-land' }),
    svg('path', { d: STATE_BORDERS, class: 'map-borders' }),
  );

  let zoom = 1;
  let view = { x: 0, y: 0, w, h }; // the part of the map on screen, in map units
  let dragged = false; // true right after a drag, so it doesn't also count as a tap

  // One <g> per place, created once. Inside it, a "marker" group holds the icon,
  // tap area and label; it's scaled by 1/zoom so they stay the same on-screen size.
  const nodes = items.map((r) => {
    const [x, y] = project(r.lat, r.lon);
    const where = r.city ? `${r.city}, ${r.region}` : r.region;
    const score = r.rating.score;
    const g = svg('g', { tabindex: '0', role: 'button', transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})` });
    const marker = svg('g', { class: 'map-marker' });
    g.append(svg('title', {}, `${r.name} (${where})${score != null ? ` · ${score}/5` : ''}`), marker);
    // A larger invisible circle makes the icon easy to tap on a phone.
    marker.append(svg('circle', { cy: -7 * k, r: 16 * k, class: 'map-hit' }));
    g.addEventListener('click', () => { if (!dragged) onSelect(r.id); });
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(r.id);
      }
    });
    root.append(g);
    return { r, g, marker, x, y, where, score, extra: classFor?.(r) ?? '', big: null, iconEl: null, labelEl: null };
  });

  // Zoom buttons, laid over the map's top-right corner
  const button = (text, labelText, onClick) => {
    const b = el('button', { type: 'button', class: 'map-zoom-button', 'aria-label': labelText }, text);
    b.addEventListener('click', onClick);
    return b;
  };
  const center = () => [view.x + view.w / 2, view.y + view.h / 2];
  const resetButton = button('⟲', 'Reset map zoom', () => setZoom(1, w / 2, h / 2));
  const controls = el('div', { class: 'map-controls' },
    button('+', 'Zoom in', () => setZoom(zoom * 1.6, ...center())),
    button('−', 'Zoom out', () => setZoom(zoom / 1.6, ...center())),
    resetButton);
  const stage = el('div', { class: 'map-stage' }, root, controls);
  resetButton.disabled = true; // nothing to reset until you zoom
  container.replaceChildren(stage);

  // ---------- Zoom & pan ----------

  // Zoom to level z, keeping the map point (mx, my) under the same spot on screen.
  function setZoom(z, mx, my) {
    z = Math.max(1, Math.min(MAX_ZOOM, z));
    const relX = (mx - view.x) / view.w;
    const relY = (my - view.y) / view.h;
    zoom = z;
    const vw = w / z;
    const vh = h / z;
    setView(mx - relX * vw, my - relY * vh, vw, vh);
    for (const n of nodes) n.marker.setAttribute('transform', `scale(${(1 / zoom).toFixed(4)})`);
    stage.classList.toggle('is-zoomed', zoom > 1);
    resetButton.disabled = zoom === 1;
    if (last) update(last); // re-place labels: they have more room when zoomed in
  }

  function setView(x, y, vw, vh) {
    // Keep the view inside the map
    view = { x: Math.max(0, Math.min(w - vw, x)), y: Math.max(0, Math.min(h - vh, y)), w: vw, h: vh };
    root.setAttribute('viewBox', `${view.x.toFixed(1)} ${view.y.toFixed(1)} ${view.w.toFixed(1)} ${view.h.toFixed(1)}`);
  }

  // Screen position -> map coordinates
  function toMap(clientX, clientY) {
    const b = root.getBoundingClientRect();
    return [view.x + ((clientX - b.left) / b.width) * view.w, view.y + ((clientY - b.top) / b.height) * view.h];
  }

  // Fingers / mouse currently pressed on the map: pointerId -> {x, y}
  const pointers = new Map();
  let startDistance = 0;
  let startZoom = 1;
  let moved = 0;

  root.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = 0;
    dragged = false;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      startDistance = Math.hypot(a.x - b.x, a.y - b.y);
      startZoom = zoom;
    }
  });
  root.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const now = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, now);
    if (pointers.size === 2) {
      // Pinch: zoom by how much the fingers spread, around the point between them
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (startDistance > 0) setZoom(startZoom * (distance / startDistance), ...toMap((a.x + b.x) / 2, (a.y + b.y) / 2));
      dragged = true;
    } else if (zoom > 1) {
      // Drag: move the view (only when zoomed in; otherwise let the page scroll)
      const box = root.getBoundingClientRect();
      const dx = ((now.x - prev.x) / box.width) * view.w;
      const dy = ((now.y - prev.y) / box.height) * view.h;
      setView(view.x - dx, view.y - dy, view.w, view.h);
      moved += Math.abs(now.x - prev.x) + Math.abs(now.y - prev.y);
      if (moved > 6) dragged = true; // a real drag, not a slightly wobbly tap
    }
  });
  const release = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) startDistance = 0;
  };
  root.addEventListener('pointerup', release);
  root.addEventListener('pointercancel', release);
  root.addEventListener('pointerleave', release);

  // Computer: double-click zooms in there; Ctrl + scroll wheel (or a trackpad pinch)
  // zooms. A plain scroll still scrolls the page.
  root.addEventListener('dblclick', (e) => setZoom(zoom * 2, ...toMap(e.clientX, e.clientY)));
  root.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom(zoom * (e.deltaY < 0 ? 1.25 : 0.8), ...toMap(e.clientX, e.clientY));
  }, { passive: false });

  // ---------- Colors, sizes and labels ----------

  let last = null;
  function update(state) {
    last = state;
    const { pinned, selected = null, visible } = state;
    const placed = []; // label boxes, so new labels can avoid them
    for (const n of nodes) {
      const isPinned = pinned.has(n.r.id);
      const isSelected = n.r.id === selected;
      const big = isPinned || isSelected;
      n.g.setAttribute('class', `map-dot ${n.extra}${isPinned ? ' is-pinned' : ''}${isSelected ? ' is-selected' : ''}${visible.has(n.r.id) || isSelected ? '' : ' is-faded'}`);
      n.g.setAttribute('aria-label', `${n.r.name}, ${n.where}${n.score != null ? `, rated ${n.score} of 5` : ''}${isPinned ? ', pinned' : ''}. Open details.`);
      if (n.big !== big) { // only swap the icon when its size changes
        const iconEl = ICONS[icon]((big ? 1.45 : 1) * k);
        if (n.iconEl) n.iconEl.replaceWith(iconEl);
        else n.marker.append(iconEl);
        n.iconEl = iconEl;
        n.big = big;
      }
      n.labelEl?.remove();
      n.labelEl = null;
    }
    // Pinned and selected icons go last, so they're drawn on top...
    const top = nodes.filter((n) => n.big).sort((a, b) => Number(a.r.id === selected) - Number(b.r.id === selected));
    for (const n of top) root.append(n.g);
    // ...and get name labels, placed so they don't overlap each other.
    for (const n of top) {
      n.labelEl = placeLabel(n.r.name, n.x, n.y, k, zoom, view, placed);
      n.marker.append(n.labelEl);
    }
  }

  return { update, width };
}

// A name label beside an icon. Start on the side with more room on screen (so it
// never runs off the edge), then if it would overlap a label already on the map,
// try a line lower, a line higher, and the other side, keeping the first free spot.
// Positions are in the marker's own units (k); overlap is checked in map units,
// where everything is 1/zoom as big.
function placeLabel(text, x, y, k, zoom, view, placed) {
  const s = k / zoom; // marker units -> map units
  const width = text.length * 7.2 * s; // rough width of 12px bold text
  const height = 14 * s;
  const preferRight = x - view.x < view.w * 0.6;
  const tries = [];
  for (const right of [preferRight, !preferRight]) {
    for (const dy of [0, 1, -1, 2, -2]) tries.push({ right, dy });
  }
  const box = ({ right, dy }) => {
    const left = right ? x + 11 * s : x - 11 * s - width;
    const base = y - 5 * s + dy * height;
    return { left, right: left + width, top: base - height * 0.8, bottom: base + height * 0.2 };
  };
  const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const choice = tries.find((t) => !placed.some((p) => overlaps(p, box(t)))) ?? tries[0];
  placed.push(box(choice));
  return svg('text', {
    x: (choice.right ? 11 : -11) * k,
    y: -5 * k + choice.dy * 14 * k,
    'text-anchor': choice.right ? 'start' : 'end',
    class: 'map-label',
  }, text);
}

// Map icons. Each stands on the place's location (the point is the middle of the
// icon's base) and is about 18 x 14 units; s scales it.
const ICONS = { peak, wave };

// A small mountain: a peak with a snowcap.
function peak(s) {
  const w = 9 * s; // half the base width
  const ht = 14 * s; // height
  const g = svg('g', { class: 'map-icon' });
  g.append(
    svg('path', { d: `M${-w} 0 L0 ${-ht} L${w} 0 Z`, class: 'icon-body' }),
    svg('path', { d: `M${-w * 0.36} ${-ht * 0.64} L0 ${-ht} L${w * 0.36} ${-ht * 0.64} L${w * 0.12} ${-ht * 0.56} L${-w * 0.1} ${-ht * 0.66} Z`, class: 'icon-cap' }),
  );
  return g;
}

// A small curling wave: a crest that rolls over to the right, with a white lip.
function wave(s) {
  const w = 9 * s;
  const ht = 13 * s;
  const g = svg('g', { class: 'map-icon' });
  g.append(
    svg('path', {
      d: `M${-w} 0 C${-w * 0.7} ${-ht * 0.7} ${-w * 0.1} ${-ht * 1.1} ${w * 0.55} ${-ht * 0.85} ` +
        `C${w * 0.15} ${-ht * 0.75} ${w * 0.05} ${-ht * 0.35} ${w * 0.45} ${-ht * 0.3} ` +
        `C${w * 0.7} ${-ht * 0.28} ${w * 0.85} ${-ht * 0.1} ${w} 0 Z`,
      class: 'icon-body',
    }),
    svg('path', {
      d: `M${-w * 0.25} ${-ht * 0.85} C${0} ${-ht * 1.0} ${w * 0.35} ${-ht * 0.98} ${w * 0.55} ${-ht * 0.85}`,
      class: 'icon-lip',
    }),
  );
  return g;
}

// A tiny standalone icon for legends: icon type + classes ('is-pinned', 'pass-ikon', ...).
export function legendIcon(type, stateClass = '') {
  const root = svg('svg', { viewBox: '-10 -15 20 16', width: 16, height: 13, class: `legend-icon map-dot ${stateClass}`, 'aria-hidden': 'true' });
  root.append(ICONS[type](1));
  return root;
}
