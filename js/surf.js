// The Surf tab: everything specific to beaches. The shared parts (pins, list,
// detail view, map) come from places.js.
import { svg, timeChart } from './charts.js';
import { setTideLevel } from './background.js';
import { createPlacesTab } from './places.js';
import {
  add, bestBetCard, chartSlot, compass, dataTable, drawCharts, formatShortDate, formatTime,
  h, num, ok, rating, stat, unavailable,
} from './ui.js';

const AREAS = ['Southern California', 'Central & NorCal', 'Pacific Northwest', 'Hawaii', 'Gulf Coast', 'Southeast', 'Mid-Atlantic', 'Northeast'];
const STATE_CODES = new Set(['ca', 'or', 'wa', 'hi', 'tx', 'fl', 'sc', 'nc', 'va', 'md', 'nj', 'ny', 'ri', 'ma', 'nh', 'me']);

let section;
let tab;
let tideStationId = null; // station shown in the "Today's tide" card
const tideCard = h('section', { class: 'card tide', 'aria-labelledby': 'h-tide' });

const waveFt = (s) => (ok(s.waves) ? s.waves.data.heightFt ?? 0 : 0);
// Period: the buoy's measured one if it's reporting, else the model's (same rule as the rating)
const period = (s) => (ok(s.buoy) && s.buoy.data.dominantPeriodS) || (ok(s.waves) ? s.waves.data.periodS : null);
const waterTemp = (s) => (ok(s.buoy) && s.buoy.data.waterTempF != null
  ? { f: Math.round(s.buoy.data.waterTempF), modelled: false }
  : ok(s.waves) && s.waves.data.seaSurfaceTempF != null ? { f: Math.round(s.waves.data.seaSurfaceTempF), modelled: true } : null);

function matches(s, q) {
  if (STATE_CODES.has(q)) return s.region.toLowerCase() === q;
  return s.name.toLowerCase().includes(q) || (s.city ?? '').toLowerCase().includes(q) || (s.area ?? '').toLowerCase().includes(q);
}

export function renderSurf(surfSection) {
  section = surfSection;
  tab = createPlacesTab({
    key: 'surf',
    panelId: 'panel-surf',
    section,
    words: {
      one: 'beach',
      many: 'beaches',
      mine: 'My beaches',
      all: 'All beaches',
      allNote: `${section.items.length} US surf spots`,
    },
    pinKey: 'ssr-surf-pinned',
    listKey: 'ssr-surf-list',
    filters: [
      { id: 'area', label: 'Area', allLabel: 'All areas', options: AREAS, test: (s, v) => s.area === v },
    ],
    sorts: [
      { value: 'rating', label: 'Best rating', compare: (a, b) => (b.rating.score ?? 0) - (a.rating.score ?? 0) || (period(b) ?? 0) - (period(a) ?? 0) },
      { value: 'waves', label: 'Biggest waves', compare: (a, b) => waveFt(b) - waveFt(a) },
      { value: 'period', label: 'Longest period', compare: (a, b) => (period(b) ?? 0) - (period(a) ?? 0) },
      { value: 'name', label: 'A–Z', compare: () => 0 },
    ],
    searchPlaceholder: 'Search by beach, town or state',
    matches,
    rowStats: (s) => {
      const w = ok(s.wind) ? ` · ${s.wind.data.speedMph} mph ${s.wind.data.relative}` : '';
      const t = waterTemp(s);
      return `${ok(s.waves) ? `${s.waves.data.heightFt} ft` : '—'} @ ${num(period(s), ' s')}${w}${t ? ` · Water ${t.f}°F` : ''}`;
    },
    card: spotCard,
    detailPill: (s) => (s.beachFacingDeg != null ? h('span', { class: 'pill' }, `Faces ${compass(s.beachFacingDeg)} (${s.beachFacingDeg}°)`) : null),
    detailBody,
    top: () => [bestBetCard(section, 'surf', (id) => tab.openDetail(id))],
    afterMine: (pinnedIds) => [drawTideCard(pinnedIds)],
    mapIcon: 'wave',
    mapLabel: 'surf spots',
  });
}

// ---------- Tides ----------

const ms = (iso) => Date.parse(iso);

function nextTides(station) {
  if (!ok(station)) return null;
  const upcoming = station.data.events.filter((e) => ms(e.t) > Date.now());
  return { high: upcoming.find((e) => e.type === 'H'), low: upcoming.find((e) => e.type === 'L') };
}

// Today's tide curve for one station, with highs/lows labelled and a "Now" line.
function tideChart(st) {
  const tz = st.timezone;
  const { curve, events, date } = st.data;
  const start = ms(curve[0].t);
  const end = ms(curve.at(-1).t);
  const todays = events.filter((e) => ms(e.t) >= start && ms(e.t) <= end);
  const hourTick = (hr) => {
    const p = curve.find((c) => Number(c.t.slice(11, 13)) === hr && c.t.slice(14, 16) === '00');
    return p && { x: ms(p.t), label: hr === 0 ? '12a' : hr === 12 ? '12p' : hr < 12 ? `${hr}a` : `${hr - 12}p` };
  };
  return [
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
      nowX: Date.now(),
      height: 190,
      tooltip: (p) => `${formatTime(p.t, tz)} · ${p.y.toFixed(1)} ft`,
    })),
    dataTable(`Tides at ${st.name}`, ['Tide', 'Time', 'Height'],
      todays.map((e) => [e.type === 'H' ? 'High' : 'Low', formatTime(e.t, tz), `${e.ft.toFixed(1)} ft`])),
  ];
}

// "Today's tide" card: one button per tide station your pinned beaches use.
let lastPinned = [];
function drawTideCard(pinnedIds = lastPinned) {
  lastPinned = pinnedIds;
  const pinnedSpots = pinnedIds.map((id) => section.items.find((s) => s.id === id));
  const choices = [];
  for (const s of pinnedSpots) {
    // Beaches that share a tide station share one button: 'El Porto & Malibu'
    const same = choices.find((c) => c.id === s.tideStation);
    if (same) same.label += ` & ${s.name}`;
    else choices.push({ id: s.tideStation, label: s.name });
  }
  if (!choices.length) {
    tideCard.replaceChildren(h('p', { class: 'fine' }, 'Pin a beach to see its tide here.'));
    return tideCard;
  }
  if (!choices.some((c) => c.id === tideStationId)) tideStationId = choices[0].id;
  const st = section.tideStations[tideStationId];

  const switcher = h('div', { class: 'switch', role: 'group', 'aria-label': 'Show the tide for' },
    choices.map((c) => {
      const b = h('button', { type: 'button', 'aria-pressed': String(c.id === tideStationId) }, c.label);
      b.addEventListener('click', () => { tideStationId = c.id; drawTideCard(); drawCharts(); });
      return b;
    }));

  tideCard.replaceChildren(
    h('header', { class: 'card-head tide-head' },
      h('div', {}, h('h3', { id: 'h-tide' }, "Today's tide"), h('p', { class: 'region' }, st?.name ?? '')),
      switcher));
  if (!ok(st)) {
    add(tideCard, unavailable('Tide predictions', st));
  } else {
    add(tideCard, tideChart(st),
      h('p', { class: 'fine' }, `Heights in feet above ${st.data.datum} (mean lower low water), local time. The water in the background rises and falls with this tide.`));
  }
  updateTideBackground();
  return tideCard;
}

// Where is the tide right now, as a fraction of today's range? (0 = lowest, 1 = highest)
function tideFraction(station) {
  if (!ok(station)) return 0.5;
  const curve = station.data.curve;
  const now = Date.now();
  const i = curve.findIndex((p) => ms(p.t) > now);
  let ft;
  if (i === -1) ft = curve.at(-1).ft;
  else if (i === 0) ft = curve[0].ft;
  else {
    const a = curve[i - 1];
    const b = curve[i];
    ft = a.ft + (b.ft - a.ft) * ((now - ms(a.t)) / (ms(b.t) - ms(a.t)));
  }
  const heights = curve.map((p) => p.ft);
  const lo = Math.min(...heights);
  const hi = Math.max(...heights);
  return (ft - lo) / (hi - lo || 1);
}

export function updateTideBackground() {
  if (section && tideStationId) setTideLevel(tideFraction(section.tideStations[tideStationId]));
}

// ---------- Cards ----------

function waveStats(s) {
  const w = s.waves;
  const t = waterTemp(s);
  return h('div', { class: 'stats' },
    stat('Waves', ok(w) ? `${w.data.heightFt} ft` : '—'),
    stat('Period', num(period(s), ' s')),
    stat(ok(w) ? `From ${w.data.directionDeg}°` : 'From', ok(w) ? compass(w.data.directionDeg) : '—'),
    stat('Water', t ? `${t.f}°F${t.modelled ? '*' : ''}` : '—'));
}

function windText(s) {
  const wind = s.wind;
  return ok(wind)
    ? `${wind.data.speedMph} mph from ${compass(wind.data.directionDeg)}, gusts ${wind.data.gustMph} · ${wind.data.relative}`
    : `Unavailable${wind.reason ? ` — ${wind.reason}` : ''}`;
}

function buoyText(s) {
  const b = s.buoy;
  if (!b) return 'No reporting buoy nearby';
  if (!ok(b)) return `Unavailable — ${b.reason}`;
  return `${b.stationName} (${b.stationId}${b.distanceKm != null ? `, ${b.distanceKm} km` : ''}): ${num(b.data.waveHeightFt, ' ft')} @ ${num(b.data.dominantPeriodS, ' s')}, measured ${formatTime(b.data.observedAt, s.timezone)}`;
}

// A pinned beach's card
function spotCard(s, ui) {
  const w = s.waves;
  const tz = s.timezone;
  const tides = nextTides(section.tideStations[s.tideStation]);
  const t = waterTemp(s);
  const card = h('article', { class: 'card', 'aria-labelledby': `h-${s.id}` },
    h('header', { class: 'card-head' },
      h('div', {},
        h('h3', { id: `h-${s.id}` }, s.name),
        h('p', { class: 'region' }, `${s.city ? `${s.city}, ` : ''}${s.region} · ${s.area ?? ''}`)),
      ok(w) ? h('span', { class: 'pill' }, `Forecast for ${formatTime(w.data.forTime, tz)}`) : null),
    rating(s.rating),
    waveStats(s),
    h('dl', { class: 'facts' },
      h('dt', {}, 'Wind'), h('dd', {}, windText(s)),
      h('dt', {}, 'Next high'), h('dd', {}, tides?.high ? `${formatTime(tides.high.t, tz)} · ${tides.high.ft.toFixed(1)} ft` : '—'),
      h('dt', {}, 'Next low'), h('dd', {}, tides?.low ? `${formatTime(tides.low.t, tz)} · ${tides.low.ft.toFixed(1)} ft` : '—'),
      h('dt', {}, 'Buoy'), h('dd', {}, buoyText(s))));
  if (!ok(w)) add(card, unavailable('Wave forecast', w));
  if (t?.modelled) add(card, h('p', { class: 'fine' }, '* Water temperature is modelled; no buoy reading.'));
  add(card, h('div', { class: 'card-actions' }, ui.detailsButton(s), ui.pinButton(s, { withText: true })));
  return card;
}

// ---------- Detail view ----------

function detailBody(s) {
  const st = section.tideStations[s.tideStation];
  const t = waterTemp(s);
  return [
    waveStats(s),
    t?.modelled ? h('p', { class: 'fine' }, '* Water temperature is modelled; no buoy reading.') : null,
    h('dl', { class: 'facts' },
      h('dt', {}, 'Wind'), h('dd', {}, windText(s)),
      h('dt', {}, 'Buoy'), h('dd', {}, buoyText(s))),
    directionCompass(s),
    hourlyChart(s),
    h('h4', {}, "Today's tide"),
    ok(st) ? [tideChart(st), h('p', { class: 'fine' }, `${st.name} station, feet above ${st.data.datum}, local time.`)] : unavailable('Tide predictions', st),
    h('h4', {}, 'About'),
    h('dl', { class: 'facts' },
      h('dt', {}, 'Faces'), h('dd', {}, s.beachFacingDeg != null ? `${compass(s.beachFacingDeg)} (${s.beachFacingDeg}°)` : '—'),
      h('dt', {}, 'Tide station'), h('dd', {}, st ? `${st.name} (${s.tideStation})` : '—'),
      h('dt', {}, 'Wave model'), h('dd', {}, ok(s.waves) ? `Open-Meteo grid point ${s.waves.data.gridPoint.lat.toFixed(2)}, ${s.waves.data.gridPoint.lon.toFixed(2)}` : '—'),
      h('dt', {}, 'Location'), h('dd', {}, `${s.lat.toFixed(3)}, ${s.lon.toFixed(3)}`),
      h('dt', {}, 'Fetched'), h('dd', {}, ok(s.waves) ? new Date(s.waves.fetchedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—')),
  ];
}

// Wave height for every hour of today, with period and wind in the tooltip.
function hourlyChart(s) {
  if (!ok(s.waves) || !s.waves.data.hourly?.length) return null;
  const tz = s.timezone;
  const hours = s.waves.data.hourly.filter((p) => p.ft != null);
  const windAt = Object.fromEntries((ok(s.wind) ? s.wind.data.hourly ?? [] : []).map((w) => [w.t, w]));
  const label = (iso) => {
    const hr = Number(iso.slice(11, 13));
    return hr === 0 ? '12a' : hr === 12 ? '12p' : hr < 12 ? `${hr}a` : `${hr - 12}p`;
  };
  const ticks = hours.filter((p) => [0, 6, 12, 18].includes(Number(p.t.slice(11, 13))));
  const biggest = hours.reduce((a, b) => (b.ft > a.ft ? b : a), hours[0]);
  return [
    h('h4', {}, 'Waves today, hour by hour'),
    chartSlot((el) => timeChart(el, {
      title: `Forecast wave height at ${s.name} today, peaking at ${biggest.ft} feet around ${formatTime(biggest.t, tz)}.`,
      points: hours.map((p) => ({ x: ms(p.t), y: p.ft, t: p.t, s: p.s })),
      xDomain: [ms(hours[0].t), ms(hours.at(-1).t)],
      xTicks: ticks.map((p) => ({ x: ms(p.t), label: label(p.t) })),
      yMin: 0,
      yMinSpan: 2,
      unit: ' ft',
      area: true,
      nowX: Date.now(),
      height: 150,
      tooltip: (p) => {
        const w = windAt[p.t];
        return `${formatTime(p.t, tz)} · ${p.y} ft @ ${p.s} s${w ? ` · wind ${w.mph} mph ${compass(w.deg)}` : ''}`;
      },
    })),
    dataTable(`Hourly forecast at ${s.name}`, ['Time', 'Waves', 'Period', 'Wind'],
      hours.map((p) => {
        const w = windAt[p.t];
        return [formatTime(p.t, tz), `${p.ft} ft`, `${p.s} s`, w ? `${w.mph} mph ${compass(w.deg)}` : '—'];
      })),
  ];
}

// A small compass: the beach's shoreline, the way it faces, and arrows showing
// where the swell and the wind are coming from.
function directionCompass(s) {
  if (s.beachFacingDeg == null || !ok(s.waves)) return null;
  const size = 132;
  const c = size / 2;
  const r = 50;
  const rad = (deg) => ((deg - 90) * Math.PI) / 180; // compass degrees -> SVG angle (0 = up)
  const pt = (deg, dist) => [c + Math.cos(rad(deg)) * dist, c + Math.sin(rad(deg)) * dist];
  const root = svg('svg', {
    viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: 'direction-compass', role: 'img',
    'aria-label': `The beach faces ${compass(s.beachFacingDeg)}. Swell from ${compass(s.waves.data.directionDeg)}` +
      (ok(s.wind) ? `, wind from ${compass(s.wind.data.directionDeg)} (${s.wind.data.relative}).` : '.'),
  });
  root.append(svg('circle', { cx: c, cy: c, r, class: 'compass-ring' }));
  for (const [deg, txt] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']]) {
    const [x, y] = pt(deg, r + 9);
    root.append(svg('text', { x, y: y + 4, 'text-anchor': 'middle', class: 'compass-label' }, txt));
  }
  // Shoreline: a line across the circle, at right angles to the way the beach faces,
  // with the land side shaded.
  const [x1, y1] = pt(s.beachFacingDeg + 90, r);
  const [x2, y2] = pt(s.beachFacingDeg - 90, r);
  root.append(svg('path', { d: `M${x1},${y1} A${r},${r} 0 0 1 ${x2},${y2} Z`, class: 'compass-land' }));
  root.append(svg('line', { x1, y1, x2, y2, class: 'compass-shore' }));
  // An arrow from the edge (where it comes from) toward the middle
  const arrow = (deg, cls) => {
    const [ax, ay] = pt(deg, r - 4);
    const [bx, by] = pt(deg, 12);
    const [h1x, h1y] = [bx + Math.cos(rad(deg) + 0.5) * 9, by + Math.sin(rad(deg) + 0.5) * 9];
    const [h2x, h2y] = [bx + Math.cos(rad(deg) - 0.5) * 9, by + Math.sin(rad(deg) - 0.5) * 9];
    root.append(svg('path', { d: `M${ax},${ay} L${bx},${by} M${h1x},${h1y} L${bx},${by} L${h2x},${h2y}`, class: `compass-arrow ${cls}` }));
  };
  arrow(s.waves.data.directionDeg, 'swell');
  if (ok(s.wind)) arrow(s.wind.data.directionDeg, 'wind');
  return h('div', { class: 'compass-wrap' },
    root,
    h('ul', { class: 'compass-key' },
      h('li', {}, h('span', { class: 'key swell' }), `Swell from ${compass(s.waves.data.directionDeg)} (${s.waves.data.directionDeg}°)`),
      ok(s.wind) ? h('li', {}, h('span', { class: 'key wind' }), `Wind from ${compass(s.wind.data.directionDeg)}, ${s.wind.data.relative}`) : null,
      h('li', {}, h('span', { class: 'key land' }), `Land side; beach faces ${compass(s.beachFacingDeg)}`)));
}
