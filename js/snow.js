// The Snow tab: everything specific to mountains. The shared parts (pins, list,
// detail view, map) come from places.js.
import { timeChart } from './charts.js';
import { createPlacesTab } from './places.js';
import {
  add, bestBetCard, chartSlot, dataTable, formatDay, formatShortDate,
  h, num, ok, rating, sourceName, stat, unavailable,
} from './ui.js';

const AREAS = ['West', 'Pacific NW', 'Rockies', 'Midwest', 'East'];
const PASSES = ['Ikon', 'Epic'];

const fresh = (r) => (ok(r.observed) ? r.observed.data.newSnow.h48 ?? 0 : 0);
const coming = (r) => (ok(r.forecast) ? r.forecast.data.next72hIn ?? 0 : 0);
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

// Small "IKON" / "EPIC" labels
function passTags(r) {
  return passNames(r).map((p) => h('span', { class: `pass-tag pass-${p.toLowerCase()}` }, p));
}

let tab;

export function renderSnow(section) {
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
    listKey: 'ssr-snow-list',
    filters: [
      { id: 'pass', label: 'Pass', allLabel: 'All passes', options: PASSES, test: (r, v) => passNames(r).includes(v) },
      { id: 'area', label: 'Area', allLabel: 'All areas', options: AREAS, test: (r, v) => r.area === v },
    ],
    sorts: [
      { value: 'rating', label: 'Best rating', compare: (a, b) => (b.rating.score ?? 0) - (a.rating.score ?? 0) || (fresh(b) + coming(b)) - (fresh(a) + coming(a)) },
      { value: 'new', label: 'Most new snow (48h)', compare: (a, b) => fresh(b) - fresh(a) },
      { value: 'forecast', label: 'Most snow coming (72h)', compare: (a, b) => coming(b) - coming(a) },
      { value: 'base', label: 'Deepest base', compare: (a, b) => base(b) - base(a) },
      { value: 'name', label: 'A–Z', compare: () => 0 },
    ],
    searchPlaceholder: 'Search by name, town, state or pass',
    matches,
    rowExtras: passTags,
    rowStats: (r) => [
      `New 48h ${num(ok(r.observed) ? r.observed.data.newSnow.h48 : null, '"')}`,
      ` · Base ${num(ok(r.observed) ? r.observed.data.depthNow : null, '"')}`,
      ` · Next 3 days ${num(ok(r.forecast) ? r.forecast.data.next72hIn : null, '"')}`,
    ].join(''),
    card: resortCard,
    detailPill: (r) => seasonPill(r.season),
    detailBody,
    top: () => [bestBetCard(section, 'snow', (id) => tab.openDetail(id))],
    mapIcon: 'peak',
    mapLabel: 'Ikon and Epic mountains',
  });
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

// A pinned mountain's card
function resortCard(r, ui) {
  const obs = r.observed;
  const fc = r.forecast;
  const card = h('article', { class: 'card', 'aria-labelledby': `h-${r.id}` },
    h('header', { class: 'card-head' },
      h('div', {},
        h('h3', { id: `h-${r.id}` }, r.name),
        h('p', { class: 'region' }, `${r.city ? `${r.city}, ` : ''}${r.region} · ${r.area ?? ''} `, passTags(r))),
      seasonPill(r.season)),
    rating(r.rating));

  add(card, ok(obs) ? snowStats(obs) : unavailable('Snow depth', obs));

  if (ok(fc)) {
    add(card,
      h('h4', {}, 'Forecast'),
      h('ol', { class: 'forecast' }, fc.data.days.slice(0, 4).map((d, i) =>
        h('li', {},
          h('span', { class: 'fc-day' }, formatDay(d.date, i)),
          h('span', { class: 'fc-snow' }, `${d.snowfall > 0 ? d.snowfall : 0}"`, h('span', { class: 'visually-hidden' }, ' snow')),
          h('span', { class: 'fc-temp' }, `${d.tempHigh}° / ${d.tempLow}°`),
          h('span', { class: 'fc-wind' }, h('span', { class: 'fc-wind-label' }, 'Wind '), `${d.windMax} mph`)))));
  } else {
    add(card, unavailable('Forecast', fc));
  }

  // (On phones the chart is left out of the card to keep it short; Details has it.)
  if (ok(obs) && obs.data.depthHistory.length > 1) add(card, h('div', { class: 'card-extra' }, depthChart(r)));
  add(card, h('div', { class: 'card-actions' }, ui.detailsButton(r), ui.pinButton(r, { withText: true })));
  return card;
}

function detailBody(r) {
  const obs = r.observed;
  const fc = r.forecast;
  const station = !ok(obs) ? '—'
    : obs.modelled ? `Modelled (${sourceName(obs.source)})`
    : `SNOTEL ${obs.stationName} (${obs.stationId}), ${obs.distanceKm} km away`;
  return [
    ok(obs) ? snowStats(obs) : unavailable('Snow depth', obs),
    ok(fc) ? forecastTable(fc) : unavailable('Forecast', fc),
    ok(obs) && obs.data.depthHistory.length > 1 ? depthChart(r) : null,
    h('h4', {}, 'About'),
    h('dl', { class: 'facts' },
      (r.passes ?? []).map((p) => [h('dt', {}, `${p.pass} Pass`), h('dd', {}, p.access)]),
      h('dt', {}, 'Season'), h('dd', {}, r.season.opensOn ? `Opens ${formatShortDate(r.season.opensOn)}` : 'Dates not set'),
      h('dt', {}, 'Snow data'), h('dd', {}, station),
      h('dt', {}, 'Location'), h('dd', {}, `${r.lat.toFixed(3)}, ${r.lon.toFixed(3)}`),
      h('dt', {}, 'Fetched'), h('dd', {}, ok(fc) ? new Date(fc.fetchedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—')),
  ];
}

function forecastTable(fc) {
  return [
    h('h4', {}, '7-day forecast'),
    h('div', { class: 'table-scroll' },
      h('table', { class: 'forecast-table' },
        h('thead', {}, h('tr', {},
          ['Day', 'Snow', 'High', 'Low', 'Wind', 'Gusts'].map((x) => h('th', { scope: 'col' }, x)))),
        h('tbody', {}, fc.data.days.map((d, i) => h('tr', {},
          h('th', { scope: 'row' }, formatDay(d.date, i)),
          h('td', {}, `${d.snowfall > 0 ? d.snowfall : 0}"`),
          h('td', {}, `${d.tempHigh}°`),
          h('td', {}, `${d.tempLow}°`),
          h('td', {}, `${d.windMax} mph`),
          h('td', {}, `${d.gustMax} mph`)))))),
  ];
}
