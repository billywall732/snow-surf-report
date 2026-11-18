// The Snow tab: everything specific to mountains. The shared parts (pins, list,
// detail view, map) come from places.js.
import { timeChart } from './charts.js';
import { createPlacesTab, stateFilter } from './places.js';
import { snowComing } from './alert-rules.js';
import { notifyButton } from './alerts.js';
import { inRangeBestBetCard, loadRider, openProfile, recommendPill } from './rider.js';
import { hasSkiRider, skiFit, skiText } from './recommend.js';
import { layersFor } from './gear.js';
import {
  chartSlot, dataTable, drawCharts, formatDay, formatShortDate,
  h, num, ok, sourceName, stat, unavailable,
} from './ui.js';

const AREAS = ['West', 'Pacific NW', 'Rockies', 'Midwest', 'East'];
const PASSES = ['Ikon', 'Epic'];

const fresh = (r) => (ok(r.observed) ? r.observed.data.newSnow.h48 ?? 0 : 0);
const coming = (r) => (ok(r.forecast) ? r.forecast.data.next72hIn ?? 0 : 0);
const days = () => tab?.days() ?? 3; // the list's "Look ahead" choice
const base = (r) => (ok(r.observed) ? r.observed.data.depthNow ?? 0 : 0);
const passNames = (r) => (r.passes ?? []).map((p) => p.pass);

// A two-letter search like 'ut' means a state; otherwise match the name, town, area or pass.
const STATE_CODES = new Set(['ak', 'ca', 'co', 'id', 'in', 'me', 'mi', 'mn', 'mo', 'mt', 'nh', 'nm', 'ny', 'oh', 'or', 'pa', 'ut', 'vt', 'wa', 'wi', 'wv', 'wy']);
function matches(r, q) {
  if (STATE_CODES.has(q)) return r.region.toLowerCase() === q;
  return r.name.toLowerCase().includes(q) ||
    (r.city ?? '').toLowerCase().includes(q) ||
    (r.area ?? '').toLowerCase().includes(q) ||
    passNames(r).some((p) => p.toLowerCase() === q);
}

// 'pass-ikon' / 'pass-epic': colors the list row, map icon and card by pass
const passClass = (r) => passNames(r).map((p) => `pass-${p.toLowerCase()}`).join(' ');

// Small "IKON" / "EPIC" labels (and "SKIERS ONLY" where snowboards aren't allowed)
function passTags(r) {
  return [
    ...passNames(r).map((p) => h('span', { class: `pass-tag pass-${p.toLowerCase()}` }, p)),
    r.skiersOnly ? h('span', { class: 'pass-tag skiers-only', title: 'No snowboarding' }, 'Skiers only') : null,
  ];
}

let tab;
let section;
let buildupMountainId = null;
const buildupCard = h('details', { class: 'card snow-buildup', open: '' });
buildupCard.addEventListener('toggle', () => { if (buildupCard.open) drawCharts(); });

export function renderSnow(snowSection) {
  section = snowSection;
  tab = createPlacesTab({
    key: 'snow',
    panelId: 'panel-snow',
    section,
    words: {
      one: 'mountain',
      many: 'mountains',
      mine: 'My mountains',
      all: 'All mountains',
      allNote: `${section.items.length} US mountains on the Ikon and Epic passes`,
    },
    pinKey: 'ssr-pinned', // (kept from before, so existing pins survive)
    listKey: 'ssr-snow-list-v2', // (v2: the default sort became A–Z)
    filters: [
      { id: 'pass', label: 'Pass', allLabel: 'All passes', options: PASSES, test: (r, v) => passNames(r).includes(v) },
      { id: 'area', label: 'Area', allLabel: 'All areas', options: AREAS, test: (r, v) => r.area === v },
      stateFilter(section.items),
    ],
    lookAhead: true,
    sorts: [
      { value: 'name', label: 'A–Z', compare: () => 0 }, // (ties are always broken A–Z)
      { value: 'rating', label: 'Best rating', compare: (a, b) => (b.rating.score ?? 0) - (a.rating.score ?? 0) || (fresh(b) + coming(b)) - (fresh(a) + coming(a)) },
      { value: 'new', label: 'Most new snow (48h)', compare: (a, b) => fresh(b) - fresh(a) },
      { value: 'forecast', label: 'Most snow coming', compare: (a, b) => snowComing(b, days()) - snowComing(a, days()) },
      { value: 'base', label: 'Deepest base', compare: (a, b) => base(b) - base(a) },
    ],
    searchPlaceholder: 'Search by name, town, state or pass',
    matches,
    rowExtras: passTags,
    itemClass: passClass,
    legend: [
      ['pass-ikon', 'Ikon'],
      ['pass-epic', 'Epic'],
      ['pass-ikon is-pinned', 'Pinned (larger, outlined)'],
    ],
    rowStats: (r) => [
      `New 48h ${num(ok(r.observed) ? r.observed.data.newSnow.h48 : null, '"')}`,
      ` · Base ${num(ok(r.observed) ? r.observed.data.depthNow : null, '"')}`,
      ` · Next ${days()} days ${num(ok(r.forecast) ? snowComing(r, days()) : null, '"')}`,
      ok(r.forecast) ? ` · ${r.forecast.data.days[0].tempHigh}°/${r.forecast.data.days[0].tempLow}°F` : '',
    ].join(''),
    tile: snowTile,
    detailPill: (r) => seasonPill(r.season),
    detailButtons: (r) => notifyButton('snow', r),
    detailBody,
    top: () => [inRangeBestBetCard('snow', (id) => tab.openDetail(id))],
    recs: () => recommendPill('snow', (id) => tab.openDetail(id)),
    afterMine: (pinnedIds) => [drawSnowBuildup(pinnedIds)],
    mapIcon: 'peak',
    mapLabel: 'Ikon and Epic mountains',
  });
  return tab;
}

// ---------- Pieces ----------

function seasonPill(season) {
  let text = 'Season dates TBD';
  if (season.status === 'open') text = 'Open (per schedule)';
  else if (season.status === 'closed') {
    text = season.opensOn ? `Opens ${formatShortDate(season.opensOn)}` : 'Closed for the season';
  }
  return h('span', { class: `pill pill-${season.status}` }, text);
}

function snowStats(obs) {
  const d = obs.data;
  return [
    h('div', { class: 'stats' },
      stat('New 24h', num(d.newSnow.h24, '"')),
      stat('New 48h', num(d.newSnow.h48, '"')),
      stat('New 7d', num(d.newSnow.d7, '"')),
      stat('Base', num(d.depthNow, '"'))),
    h('p', { class: 'fine' },
      obs.modelled
        ? `Modelled by ${sourceName(obs.source)}. ${obs.note ?? 'No SNOTEL station nearby.'}`
        : `Measured at SNOTEL ${obs.stationName} (${obs.distanceKm} km away). New snow = daily depth gains.`),
  ];
}

function depthChart(r) {
  const hist = r.observed.data.depthHistory;
  const toMs = (date) => Date.parse(`${date}T12:00Z`);
  const allZero = hist.every((p) => p.depth === 0);
  return [
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
    allZero ? h('p', { class: 'fine' }, 'No snow on the ground here yet.') : null,
    dataTable(`Snow depth at ${r.name}`, ['Date', 'Depth'], hist.map((p) => [formatShortDate(p.date), `${p.depth}"`])),
  ];
}

// A pinned mountain's tile: two numbers and the one thing worth knowing today
// (snow on the way, fresh snow, opening day, how cold it feels). Details has the rest.
function snowTile(r) {
  return {
    stats: [
      `48h ${num(ok(r.observed) ? r.observed.data.newSnow.h48 : null, '"')}`,
      `Next 3d ${num(ok(r.forecast) ? r.forecast.data.next72hIn : null, '"')}`,
    ],
    insight: snowInsight(r),
  };
}

function drawSnowBuildup(pinnedIds = []) {
  const mountains = pinnedIds.map((id) => section.items.find((r) => r.id === id)).filter(Boolean);
  if (!mountains.some((r) => r.id === buildupMountainId)) buildupMountainId = mountains[0]?.id ?? null;
  const mountain = mountains.find((r) => r.id === buildupMountainId);
  const previous = h('button', { type: 'button', class: 'stepper-arrow', 'aria-label': 'Previous pinned mountain', hidden: mountains.length < 2 }, '‹');
  const next = h('button', { type: 'button', class: 'stepper-arrow', 'aria-label': 'Next pinned mountain', hidden: mountains.length < 2 }, '›');
  const step = (direction) => {
    const index = mountains.findIndex((r) => r.id === buildupMountainId);
    buildupMountainId = mountains[(index + direction + mountains.length) % mountains.length].id;
    drawSnowBuildup(pinnedIds);
    drawCharts();
  };
  previous.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));

  const body = [];
  if (!mountain) {
    body.push(h('p', { class: 'fine' }, 'Pin a mountain to see its snow buildup here.'));
  } else {
    const obs = mountain.observed;
    const forecast = mountain.forecast;
    const fcDays = ok(forecast) ? forecast.data.days.slice(0, 7) : [];
    const chartDays = fcDays.filter((d) => Number.isFinite(d.snowfall));
    body.push(
      h('div', { class: 'snow-buildup-stats' },
        stat('Base', num(ok(obs) ? obs.data.depthNow : null, '"')),
        stat('New 48h', num(ok(obs) ? obs.data.newSnow.h48 : null, '"')),
        stat('New 7d', num(ok(obs) ? obs.data.newSnow.d7 : null, '"'))),
      h('p', { class: 'fine' }, ok(obs)
        ? obs.modelled
          ? `Base modelled by ${sourceName(obs.source)}; natural snow only, snowmaking is not included.`
          : `Base reported by SNOTEL ${obs.stationName}; natural/snowmaking split is not reported by this feed.`
        : 'Snow base and past snowfall are unavailable from the report.'),
      h('h4', {}, fcDays.length >= 7 ? '7-day forecast' : `Next ${fcDays.length || 3} days`),
      chartDays.length
        ? chartSlot((el) => {
          const points = chartDays.map((d) => ({
            x: Date.parse(`${d.date}T12:00Z`), y: d.snowfall, date: d.date,
            dayIndex: fcDays.findIndex((forecastDay) => forecastDay.date === d.date),
          }));
          const start = points[0].x;
          const end = points.at(-1).x;
          timeChart(el, {
            title: `Projected snowfall at ${mountain.name} over the next ${fcDays.length} days.`,
            points,
            xDomain: points.length > 1 ? [start, end] : [start - 43_200_000, end + 43_200_000],
            xTicks: points.map((p) => ({ x: p.x, label: formatDay(p.date, p.dayIndex) })),
            yMin: 0,
            yMinSpan: 1,
            unit: '"',
            area: true,
            height: 150,
            tooltip: (p) => `${formatShortDate(p.date)}: ${p.y}" forecast`,
          });
        })
        : ok(forecast) ? h('p', { class: 'fine' }, 'Forecast snowfall values are —.') : unavailable('Snowfall forecast', forecast),
      fcDays.length
        ? dataTable(`Projected snowfall at ${mountain.name}`, ['Day', 'Snow'], fcDays.map((d, i) => [formatDay(d.date, i), num(d.snowfall, '"')]))
        : null,
      h('p', { class: 'fine' }, 'The report does not include resort-reported natural versus snowmaking totals, so no split is estimated.'),
    );
  }
  buildupCard.replaceChildren(
    h('summary', { class: 'snow-buildup-summary' },
      h('span', { class: 'snow-buildup-title' }, 'Snow buildup'),
      h('span', { class: 'snow-buildup-mountain' }, mountain?.name ?? 'Pinned mountains'),
      h('span', { class: 'chevron', 'aria-hidden': 'true' })),
    h('div', { class: 'snow-buildup-body' },
      mountain ? h('div', { class: 'mountain-stepper', role: 'group', 'aria-label': 'Select a pinned mountain' },
        previous, h('span', { class: 'mountain-stepper-name', title: mountain.name }, mountain.name), next) : null,
      body));
  return buildupCard;
}

function snowInsight(r) {
  const parts = [];
  if (coming(r) >= 4) parts.push(`❄ ${coming(r)}" on the way`);
  else if (fresh(r) >= 4) parts.push(`Fresh: ${fresh(r)}" in 48 hours`);
  else if (r.season.status === 'closed' && r.season.opensOn) parts.push(`Opens ${formatShortDate(r.season.opensOn)}`);
  const w = ok(r.forecast) ? layersFor(r.forecast.data.days[0]) : null;
  if (w) parts.push(`feels ${w.low}–${w.high}°F`);
  const text = parts.join(' · ') || r.rating.reason;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function detailBody(r) {
  const obs = r.observed;
  const fc = r.forecast;
  const station = !ok(obs) ? '—'
    : obs.modelled ? `Modelled (${sourceName(obs.source)})`
    : `SNOTEL ${obs.stationName} (${obs.stationId}), ${obs.distanceKm} km away`;
  return [
    h('h4', {}, 'Snow on the ground'),
    ok(obs) ? snowStats(obs) : unavailable('Snow depth', obs),
    forYou(r),
    ok(fc) ? wearSection(fc.data.days[0]) : null,
    ok(fc) ? forecastTable(fc) : unavailable('Forecast', fc),
    ok(obs) && obs.data.depthHistory.length > 1 ? depthChart(r) : null,
    h('h4', {}, 'About'),
    h('dl', { class: 'facts' },
      (r.passes ?? []).map((p) => [h('dt', {}, `${p.pass} Pass`), h('dd', {}, p.access)]),
      h('dt', {}, 'Terrain'), h('dd', {}, terrainText(r.terrain)),
      h('dt', {}, 'Terrain parks'), h('dd', {}, r.terrainParks === true ? 'Yes' : r.terrainParks === false ? 'No' : 'Not listed'),
      h('dt', {}, 'Snowboarding'), h('dd', {}, r.skiersOnly ? 'Not allowed (skiers only)' : 'Allowed'),
      h('dt', {}, 'Season'), h('dd', {}, r.season.opensOn ? `Opens ${formatShortDate(r.season.opensOn)}` : 'Dates not set'),
      h('dt', {}, 'Snow data'), h('dd', {}, station),
      h('dt', {}, 'Location'), h('dd', {}, `${r.lat.toFixed(3)}, ${r.lon.toFixed(3)}`),
      h('dt', {}, 'Fetched'), h('dd', {}, ok(fc) ? new Date(fc.fetchedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—')),
  ];
}

// "15% beginner · 30% intermediate · 55% advanced (20% expert)"
function terrainText(t) {
  if (!t) return 'Not listed';
  const parts = [['beginner', t.beginner], ['intermediate', t.intermediate], ['advanced', t.advanced]]
    .filter(([, v]) => v != null).map(([k, v]) => `${v}% ${k}`);
  return `${parts.join(' · ')}${t.expert ? ` (${t.expert}% expert)` : ''}`;
}

// Does this mountain suit you? Uses your Rider Profile.
function forYou(r) {
  const rider = loadRider();
  if (!hasSkiRider(rider)) {
    const b = h('button', { type: 'button', class: 'text-button inline-link' }, 'Set up your Rider Profile');
    b.addEventListener('click', openProfile);
    return [h('h4', {}, 'For you'), h('p', { class: 'fine' }, b, ' to see whether this mountain suits how you ride.')];
  }
  const { blockers, reasons } = skiFit(r, rider);
  const row = (good, text) => h('li', { class: good ? 'fits' : 'no-fit' },
    h('span', { class: 'fit-mark', 'aria-hidden': 'true' }, good ? '✓' : '✗'),
    h('span', {}, h('span', { class: 'visually-hidden' }, good ? 'Good: ' : 'Not for you: '), text));
  // Reasons that are really downsides get a ✗ too
  const bad = /^(No terrain park|Little beginner terrain|Terrain mix unknown)/;
  return [
    h('h4', {}, 'For you'),
    h('p', { class: 'fine' }, `As a ${skiText(rider) || 'rider'}:`),
    h('ul', { class: 'for-you-list' },
      blockers.map((x) => row(false, x)),
      reasons.filter(Boolean).map((x) => row(!bad.test(x), x))),
  ];
}

// The detail view's "What to wear today" section
function wearSection(day) {
  const w = layersFor(day);
  if (!w) return null;
  return [
    h('h4', {}, 'What to wear today'),
    h('div', { class: 'stats' },
      stat('High', `${day.tempHigh}°F`),
      stat('Low', `${day.tempLow}°F`),
      stat('Feels like', w.feelsLike ? `${w.low}–${w.high}°F` : '—'),
      stat('Wind', `${day.windMax} mph`)),
    h('dl', { class: 'facts' },
      h('dt', {}, 'Base'), h('dd', {}, w.layers.base),
      h('dt', {}, 'Mid'), h('dd', {}, w.layers.mid),
      h('dt', {}, 'Outer'), h('dd', {}, w.layers.outer),
      h('dt', {}, 'Extras'), h('dd', {}, w.layers.extras)),
    w.notes.map((n) => h('p', { class: 'fine' }, n)),
    w.warning ? h('p', { class: 'fine warn' }, w.warning) : null,
    h('p', { class: 'fine' }, '“Feels like” includes wind chill, from 9 AM to 4 PM at the mountain’s location. It’s colder up top: about 3–5°F less for every 1,000 ft you climb.'),
  ];
}

function forecastTable(fc) {
  return [
    h('h4', {}, '7-day forecast'),
    h('div', { class: 'table-scroll' },
      h('table', { class: 'forecast-table' },
        h('thead', {}, h('tr', {},
          ['Day', 'Snow', 'High', 'Low', 'Feels like', 'Wind', 'Gusts'].map((x) => h('th', { scope: 'col' }, x)))),
        h('tbody', {}, fc.data.days.map((d, i) => h('tr', {},
          h('th', { scope: 'row' }, formatDay(d.date, i)),
          h('td', {}, `${d.snowfall > 0 ? d.snowfall : 0}"`),
          h('td', {}, `${d.tempHigh}°`),
          h('td', {}, `${d.tempLow}°`),
          h('td', {}, d.feelsLow != null ? `${d.feelsLow}–${d.feelsHigh}°` : '—'),
          h('td', {}, `${d.windMax} mph`),
          h('td', {}, `${d.gustMax} mph`)))))),
  ];
}
