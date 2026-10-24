// Small building blocks shared by the Snow and Surf tabs.
import { ratingBar } from './charts.js';

// The loaded report, set once by app.js. (An object, so other files see updates.)
export const state = { report: null };

// ---------- Building elements ----------

// Like el.append(), but skips null/false (plain append() would print "null").
export function add(el, ...children) {
  for (const c of children.flat(Infinity)) { // flatten nested lists of any depth
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// Build an HTML element: h('p', { class: 'note' }, 'Hello', otherElement)
// Strings become text nodes, so data can never inject HTML into the page.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  return add(el, ...children);
}

// ---------- Formatting ----------

export const ok = (block) => block?.status === 'ok';
export const num = (v, unit = '') => (v == null ? '—' : `${v}${unit}`);

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (deg) => (deg == null ? '—' : COMPASS[Math.round(deg / 22.5) % 16]);

export function formatTime(iso, timeZone) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone });
}
export function formatDay(date, i) {
  if (i === 0) return 'Today';
  return new Date(`${date}T12:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}
export function formatShortDate(date) {
  return new Date(`${date}T12:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
export function sourceName(id) {
  return state.report.sources[id]?.name ?? id;
}

// ---------- Common pieces ----------

// "Unavailable — HTTP 503 from ..." box shown in place of missing data
export function unavailable(label, block) {
  return h('p', { class: 'unavailable' }, `${label} unavailable`, block?.reason ? ` — ${block.reason}` : '');
}

export function rating(r) {
  const label = r.score == null ? 'Not rated' : `Rating ${r.score} out of 5`;
  return h('div', { class: 'rating', role: 'img', 'aria-label': `${label}. ${r.reason}` },
    h('div', { class: 'rating-top' },
      ratingBar(r.score),
      h('span', { class: 'rating-score' }, r.score == null ? '–' : `${r.score}/5`)),
    h('p', { class: 'rating-reason' }, r.reason));
}

export function stat(label, value) {
  return h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, value), h('span', { class: 'stat-label' }, label));
}

// A <details> table with the chart's numbers, for screen readers and the curious.
export function dataTable(caption, headers, rows) {
  return h('details', { class: 'data-table' },
    h('summary', {}, 'Show data'),
    h('table', {},
      h('caption', { class: 'visually-hidden' }, caption),
      h('thead', {}, h('tr', {}, headers.map((x) => h('th', { scope: 'col' }, x)))),
      h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c)))))));
}

export function bestBetCard(section, kind, onDetails) {
  const b = section.bestBet;
  if (!b) return h('section', { class: 'best-bet' }, h('p', {}, 'No best bet today — not enough data.'));
  const item = section.items.find((x) => x.id === b.id);
  const slim = b.score <= 2;
  const card = h('section', { class: 'best-bet', 'aria-label': `Best bet for ${kind}` },
    h('p', { class: 'kicker' }, slim ? `Best bet for ${kind} · slim pickings` : `Best bet for ${kind}`),
    h('h2', {}, b.name),
    item ? rating(item.rating) : null,
    section.verdict?.text ? h('p', { class: 'verdict' }, section.verdict.text) : null);
  if (onDetails) {
    const btn = h('button', { type: 'button', class: 'text-button' }, 'See details');
    btn.addEventListener('click', () => onDetails(b.id));
    card.append(btn);
  }
  return card;
}

// ---------- Charts that redraw at their real width ----------

const chartDrawers = []; // { el, draw } for each chart

// A chart placeholder; the real SVG is drawn once we know its width.
export function chartSlot(draw) {
  const el = h('div', { class: 'chart-wrap' });
  chartDrawers.push({ el, draw });
  return el;
}

export function drawCharts() {
  for (let i = chartDrawers.length - 1; i >= 0; i--) {
    const { el, draw } = chartDrawers[i];
    if (!el.isConnected) chartDrawers.splice(i, 1); // removed from the page
    else if (el.offsetParent !== null) draw(el); // skip charts that are hidden
  }
}
