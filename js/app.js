// Snow and Surf Report — reads data/report.json and builds the page.
// Everything here runs in the browser. No data is fetched from the weather APIs
// directly; the GitHub Action already did that and saved the result.
import { ratingBar, timeChart } from './charts.js';

const TAB_KEY = 'ssr-tab';
let report;
const chartDrawers = []; // { el, draw } for each chart, so we can redraw at the current width

// ---------- Small helpers ----------

// Build an HTML element: h('p', { class: 'note' }, 'Hello', otherElement)
// Strings become text nodes, so data can never inject HTML into the page.
// Like el.append(), but skips null/false (plain append() would print "null").
function add(el, ...children) {
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  return add(el, ...children);
}

const ok = (block) => block?.status === 'ok';
const num = (v, unit = '') => (v == null ? '—' : `${v}${unit}`);

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = (deg) => (deg == null ? '—' : COMPASS[Math.round(deg / 22.5) % 16]);

function formatTime(iso, timeZone) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone });
}
function formatDay(date, i) {
  if (i === 0) return 'Today';
  return new Date(`${date}T12:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}
function formatShortDate(date) {
  return new Date(`${date}T12:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
function sourceName(id) {
  return report.sources[id]?.name ?? id;
}

// "Unavailable — HTTP 503 from ..." box shown in place of missing data
function unavailable(label, block) {
  return h('p', { class: 'unavailable' }, `${label} unavailable`, block?.reason ? ` — ${block.reason}` : '');
}

function rating(r) {
  const label = r.score == null ? 'Not rated' : `Rating ${r.score} out of 5`;
  return h('div', { class: 'rating', role: 'img', 'aria-label': `${label}. ${r.reason}` },
    h('div', { class: 'rating-top' },
      ratingBar(r.score),
      h('span', { class: 'rating-score' }, r.score == null ? '–' : `${r.score}/5`)),
    h('p', { class: 'rating-reason' }, r.reason));
}

function stat(label, value) {
  return h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, value), h('span', { class: 'stat-label' }, label));
}

// A <details> table with the chart's numbers, for screen readers and the curious.
function dataTable(caption, headers, rows) {
  return h('details', { class: 'data-table' },
    h('summary', {}, 'Show data'),
    h('table', {},
      h('caption', { class: 'visually-hidden' }, caption),
      h('thead', {}, h('tr', {}, headers.map((x) => h('th', { scope: 'col' }, x)))),
      h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c)))))));
}

// A chart placeholder; the real SVG is drawn once we know its width.
function chartSlot(draw) {
  const el = h('div', { class: 'chart-wrap' });
  chartDrawers.push({ el, draw });
  return el;
}

function bestBetCard(section, kind) {
  const b = section.bestBet;
  if (!b) return h('section', { class: 'best-bet' }, h('p', {}, 'No best bet today — not enough data.'));
  const item = section.items.find((x) => x.id === b.id);
  const slim = b.score <= 2;
  return h('section', { class: 'best-bet', 'aria-label': `Best bet for ${kind}` },
    h('p', { class: 'kicker' }, slim ? `Best bet for ${kind} · slim pickings` : `Best bet for ${kind}`),
    h('h2', {}, b.name),
    item ? rating(item.rating) : null,
    section.verdict?.text ? h('p', { class: 'verdict' }, section.verdict.text) : null);
}

// ---------- Snow ----------

function seasonPill(season) {
  let text = 'Season dates TBD';
  if (season.status === 'open') text = 'Open (per schedule)';
  else if (season.status === 'closed') {
    text = season.opensOn ? `Opens ${formatShortDate(season.opensOn)}` : 'Closed for the season';
  }
  return h('span', { class: `pill pill-${season.status}` }, text);
}

function resortCard(r) {
  const obs = r.observed;
  const fc = r.forecast;
  const card = h('article', { class: 'card', 'aria-labelledby': `h-${r.id}` },
    h('header', { class: 'card-head' },
      h('div', {},
        h('h3', { id: `h-${r.id}` }, r.name),
        h('p', { class: 'region' }, r.region)),
      seasonPill(r.season)),
    rating(r.rating));

  // New snow + base depth
  if (ok(obs)) {
    const d = obs.data;
    add(card, 
      h('div', { class: 'stats' },
        stat('New 24h', num(d.newSnow.h24, '"')),
        stat('New 48h', num(d.newSnow.h48, '"')),
        stat('New 7d', num(d.newSnow.d7, '"')),
        stat('Base', num(d.depthNow, '"'))),
      h('p', { class: 'fine' },
        obs.modelled
          ? `Modelled by ${sourceName(obs.source)}. ${obs.note ?? 'No SNOTEL station nearby.'}`
          : `Measured at SNOTEL ${obs.stationName} (${obs.distanceKm} km away). New snow = daily depth gains.`),
    );
  } else {
    add(card, unavailable('Snow depth', obs));
  }

  // 4-day mini forecast
  if (ok(fc)) {
    const days = fc.data.days.slice(0, 4);
    add(card, 
      h('h4', {}, 'Forecast'),
      h('ol', { class: 'forecast' }, days.map((d, i) =>
        h('li', {},
          h('span', { class: 'fc-day' }, formatDay(d.date, i)),
          h('span', { class: 'fc-snow' }, d.snowfall > 0 ? `${d.snowfall}"` : '0"', h('span', { class: 'visually-hidden' }, ' snow')),
          h('span', { class: 'fc-temp' }, `${d.tempHigh}° / ${d.tempLow}°`),
          h('span', { class: 'fc-wind' }, `Wind ${d.windMax} mph`)))));
  } else {
    add(card, unavailable('Forecast', fc));
  }

  // Snow depth over the last 10 days
  if (ok(obs) && obs.data.depthHistory.length > 1) {
    const hist = obs.data.depthHistory;
    const toMs = (date) => Date.parse(`${date}T12:00Z`);
    const allZero = hist.every((p) => p.depth === 0);
    add(card, 
      h('h4', {}, 'Snow depth, last 10 days'),
      chartSlot((el) => timeChart(el, {
        title: `Snow depth at ${r.name} over the last ${hist.length} days, from ${hist[0].depth} inches on ${formatShortDate(hist[0].date)} to ${hist.at(-1).depth} inches on ${formatShortDate(hist.at(-1).date)}.`,
        points: hist.map((p) => ({ x: toMs(p.date), y: p.depth, date: p.date })),
        xDomain: [toMs(hist[0].date), toMs(hist.at(-1).date)],
        xTicks: [hist[0], hist.at(-1)].map((p) => ({ x: toMs(p.date), label: formatShortDate(p.date) })),
        yMin: 0,
        yMinSpan: 10,
        unit: '"',
        area: true,
        endLabel: true,
        height: 130,
        tooltip: (p) => `${formatShortDate(p.date)}: ${p.y}" on the ground`,
      })),
      allZero ? h('p', { class: 'fine' }, 'No snow on the ground at this station yet.') : null,
      dataTable(`Snow depth at ${r.name}`, ['Date', 'Depth'], hist.map((p) => [formatShortDate(p.date), `${p.depth}"`])),
    );
  }
  return card;
}

function renderSnow(section) {
  const panel = document.getElementById('panel-snow');
  panel.replaceChildren(
    bestBetCard(section, 'snow'),
    h('div', { class: 'cards' }, section.items.map(resortCard)));
}

// ---------- Surf ----------

let tideStationId = null;

function tideSection(section) {
  // Order stations by the first spot that uses them. (We can't rely on the object's
  // key order: JavaScript sorts number-like keys such as "9410840" numerically.)
  const order = [...new Set(section.items.map((s) => s.tideStation))];
  const stations = Object.entries(section.tideStations)
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));
  tideStationId ??= stations[0]?.[0];
  const wrap = h('section', { class: 'card tide', 'aria-labelledby': 'h-tide' });

  const draw = () => {
    const st = section.tideStations[tideStationId];
    const switcher = h('div', { class: 'switch', role: 'group', 'aria-label': 'Tide station' },
      stations.map(([id, s]) => {
        const b = h('button', { type: 'button', 'aria-pressed': String(id === tideStationId) }, s.shortName ?? s.name);
        b.addEventListener('click', () => { tideStationId = id; draw(); drawCharts(); });
        return b;
      }));

    wrap.replaceChildren(
      h('header', { class: 'card-head' },
        h('div', {}, h('h3', { id: 'h-tide' }, "Today's tide"), h('p', { class: 'region' }, st.name)),
        switcher));

    if (!ok(st)) { add(wrap, unavailable('Tide predictions', st)); return; }

    const tz = st.timezone;
    const { curve, events, date } = st.data;
    const ms = (iso) => Date.parse(iso);
    const start = ms(curve[0].t);
    const end = ms(curve.at(-1).t);
    const todays = events.filter((e) => ms(e.t) >= start && ms(e.t) <= end);
    const now = Date.now();
    const hourTick = (hr) => {
      const p = curve.find((c) => Number(c.t.slice(11, 13)) === hr && c.t.slice(14, 16) === '00');
      return p && { x: ms(p.t), label: hr === 0 ? '12a' : hr === 12 ? '12p' : hr < 12 ? `${hr}a` : `${hr - 12}p` };
    };

    add(wrap, 
      chartSlot((el) => timeChart(el, {
        title: `Tide at ${st.name} on ${formatShortDate(date)}: ` +
          todays.map((e) => `${e.type === 'H' ? 'high' : 'low'} ${e.ft} feet at ${formatTime(e.t, tz)}`).join(', ') + '.',
        points: curve.map((c) => ({ x: ms(c.t), y: c.ft, t: c.t })),
        xDomain: [start, end],
        xTicks: [0, 6, 12, 18].map(hourTick).filter(Boolean),
        unit: ' ft',
        area: true,
        markers: todays.map((e) => ({
          x: ms(e.t), y: e.ft, below: e.type === 'L',
          label: `${e.type === 'H' ? 'High' : 'Low'} ${formatTime(e.t, tz)}`,
        })),
        nowX: now,
        height: 190,
        tooltip: (p) => `${formatTime(p.t, tz)} · ${p.y.toFixed(1)} ft`,
      })),
      h('p', { class: 'fine' }, `Heights in feet above ${st.data.datum} (mean lower low water). Times are local to the station.`),
      dataTable(`Tides at ${st.name}`, ['Tide', 'Time', 'Height'],
        todays.map((e) => [e.type === 'H' ? 'High' : 'Low', formatTime(e.t, tz), `${e.ft.toFixed(1)} ft`])));
  };
  draw();
  return wrap;
}

function nextTides(station) {
  if (!ok(station)) return null;
  const now = Date.now();
  const upcoming = station.data.events.filter((e) => Date.parse(e.t) > now);
  return { high: upcoming.find((e) => e.type === 'H'), low: upcoming.find((e) => e.type === 'L') };
}

function spotCard(s, section) {
  const w = s.waves;
  const wind = s.wind;
  const buoy = s.buoy;
  const station = section.tideStations[s.tideStation];
  const tz = s.timezone;

  const card = h('article', { class: 'card', 'aria-labelledby': `h-${s.id}` },
    h('header', { class: 'card-head' },
      h('div', {}, h('h3', { id: `h-${s.id}` }, s.name), h('p', { class: 'region' }, s.region)),
      ok(w) ? h('span', { class: 'pill' }, `Forecast for ${formatTime(w.data.forTime, tz)}`) : null),
    rating(s.rating));

  const waterTemp = ok(buoy) && buoy.data.waterTempF != null
    ? `${Math.round(buoy.data.waterTempF)}°F`
    : ok(w) && w.data.seaSurfaceTempF != null ? `${Math.round(w.data.seaSurfaceTempF)}°F*` : '—';

  const tides = nextTides(station);
  add(card, h('div', { class: 'stats' },
    stat('Waves', ok(w) ? `${w.data.heightFt} ft` : '—'),
    stat('Period', ok(w) ? `${ok(buoy) && buoy.data.dominantPeriodS ? buoy.data.dominantPeriodS : w.data.periodS} s` : '—'),
    stat(ok(w) ? `From ${w.data.directionDeg}°` : 'From', ok(w) ? compass(w.data.directionDeg) : '—'),
    stat('Water', waterTemp)));

  add(card, h('dl', { class: 'facts' },
    h('dt', {}, 'Wind'),
    h('dd', {}, ok(wind)
      ? `${wind.data.speedMph} mph from ${compass(wind.data.directionDeg)}, gusts ${wind.data.gustMph} · ${wind.data.relative}`
      : `Unavailable${wind.reason ? ` — ${wind.reason}` : ''}`),
    h('dt', {}, 'Next high'),
    h('dd', {}, tides?.high ? `${formatTime(tides.high.t, tz)} · ${tides.high.ft.toFixed(1)} ft` : '—'),
    h('dt', {}, 'Next low'),
    h('dd', {}, tides?.low ? `${formatTime(tides.low.t, tz)} · ${tides.low.ft.toFixed(1)} ft` : '—'),
    h('dt', {}, 'Buoy'),
    h('dd', {}, ok(buoy)
      ? `${buoy.stationName} (${buoy.stationId}): ${num(buoy.data.waveHeightFt, ' ft')} @ ${num(buoy.data.dominantPeriodS, ' s')}, measured ${formatTime(buoy.data.observedAt, tz)}`
      : buoy ? `Unavailable — ${buoy.reason}` : 'No nearby buoy')));

  if (!ok(w)) add(card, unavailable('Wave forecast', w));
  if (waterTemp.endsWith('*')) add(card, h('p', { class: 'fine' }, '* Water temperature is modelled; the buoy has no recent reading.'));
  return card;
}

function renderSurf(section) {
  const panel = document.getElementById('panel-surf');
  panel.replaceChildren(
    bestBetCard(section, 'surf'),
    tideSection(section),
    h('div', { class: 'cards' }, section.items.map((s) => spotCard(s, section))));
}

// ---------- Header, footer, tabs ----------

function renderHeader() {
  const updated = new Date(report.generatedAt);
  document.getElementById('updated').textContent =
    'Updated ' + updated.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

  const ageHours = (Date.now() - updated) / 3_600_000;
  const stale = document.getElementById('stale');
  if (ageHours > 30) {
    stale.textContent = `Heads up: this report is ${Math.round(ageHours / 24)} day(s) old. The morning update may have failed.`;
    stale.hidden = false;
  }
}

// Walk the report and find every block with a source, so the footer can say
// when each source was last fetched and whether anything failed.
function collectBlocks(node, out = []) {
  if (node && typeof node === 'object') {
    if (typeof node.source === 'string' && node.fetchedAt) out.push(node);
    for (const v of Object.values(node)) collectBlocks(v, out);
  }
  return out;
}

function renderSources() {
  const blocks = collectBlocks(report.sections);
  const items = Object.entries(report.sources)
    .filter(([id]) => blocks.some((b) => b.source === id))
    .map(([id, s]) => {
      const mine = blocks.filter((b) => b.source === id);
      const latest = mine.map((b) => b.fetchedAt).sort().at(-1);
      const failed = mine.filter((b) => b.status !== 'ok').length;
      return h('li', {},
        s.url ? h('a', { href: s.url, rel: 'noopener' }, s.name) : s.name,
        ` — fetched ${formatTime(latest)}`,
        failed ? h('span', { class: 'warn' }, ` · ${failed} unavailable`) : null);
    });
  document.getElementById('sources').replaceChildren(
    h('h2', {}, 'Sources'),
    h('ul', {}, items),
    h('p', { class: 'fine' }, 'Season dates come from the config file. Ratings are simple rules, not advice — check the resort and the beach before you go.'));
}

function setupTabs() {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const select = (tab, focus) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    }
    if (focus) tab.focus();
    try { localStorage.setItem(TAB_KEY, tab.id); } catch { /* private mode: fine */ }
    drawCharts(); // charts on a newly shown tab need drawing at their real width
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    // Arrow keys move between tabs (the standard keyboard pattern for tabs)
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (d) select(tabs[(i + d + tabs.length) % tabs.length], true);
    });
  });
  // A link like .../#surf opens that tab; otherwise use the last tab you picked.
  let saved = location.hash ? `tab-${location.hash.slice(1)}` : null;
  try { saved ??= localStorage.getItem(TAB_KEY); } catch { /* ignore */ }
  select(tabs.find((t) => t.id === saved) ?? tabs[0]);
}

function drawCharts() {
  for (let i = chartDrawers.length - 1; i >= 0; i--) {
    const { el, draw } = chartDrawers[i];
    if (!el.isConnected) chartDrawers.splice(i, 1); // removed from the page (e.g. tide station switched)
    else if (el.offsetParent !== null) draw(el); // skip charts on the hidden tab
  }
}

// ---------- Start ----------

async function main() {
  try {
    const res = await fetch('data/report.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    report = await res.json();
  } catch (err) {
    document.getElementById('updated').textContent = `Could not load the report (${err.message}).`;
    return;
  }
  renderHeader();
  renderSnow(report.sections.snow);
  renderSurf(report.sections.surf);
  renderSources();
  setupTabs();

  let timer;
  window.addEventListener('resize', () => {
    clearTimeout(timer);
    timer = setTimeout(drawCharts, 150);
  });
}

main();
