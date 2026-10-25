// Builds data/report.json from the places in config/ and the free public APIs.
// Run it with:  node scripts/fetch-report.mjs
//
// Every fetch is wrapped so that a failing source becomes an "unavailable" block
// instead of crashing the run. All requests run at the same time (Promise.all)
// so the whole thing takes a few seconds, not a minute.
import fs from 'node:fs/promises';
import { wrap } from './lib/http.mjs';
import { todayIn } from './lib/time.mjs';
import { mountainForecast, surfWind } from './lib/sources/open-meteo.mjs';
import { waves } from './lib/sources/marine.mjs';
import { tides } from './lib/sources/coops.mjs';
import { buoy } from './lib/sources/ndbc.mjs';
import { snowDepth } from './lib/sources/snotel.mjs';
import { bestBet, rateResort, rateSpot, ratingPeriod, windRelative } from './lib/ratings.mjs';

const root = new URL('..', import.meta.url);
const readJSON = async (path) => JSON.parse(await fs.readFile(new URL(path, root), 'utf8'));

const SOURCES = {
  'open-meteo': { name: 'Open-Meteo Forecast API', url: 'https://open-meteo.com/' },
  'open-meteo-marine': { name: 'Open-Meteo Marine API', url: 'https://open-meteo.com/en/docs/marine-weather-api' },
  'noaa-coops': { name: 'NOAA CO-OPS Tides & Currents', url: 'https://tidesandcurrents.noaa.gov/' },
  'noaa-ndbc': { name: 'NOAA National Data Buoy Center', url: 'https://www.ndbc.noaa.gov/' },
  'nrcs-snotel': { name: 'USDA NRCS SNOTEL (AWDB)', url: 'https://www.nrcs.usda.gov/resources/data-and-reports/snow-and-water-interactive-map' },
  config: { name: 'Season dates from config/locations.json', url: null },
};

// Open / closed comes from the dates in the config, not a live feed.
function seasonStatus(resort) {
  const s = resort.season ?? {};
  const today = todayIn(resort.timezone);
  let status = 'unknown';
  if (s.opensOn && today < s.opensOn) status = 'closed';
  else if (s.closesOn && today > s.closesOn) status = 'closed';
  else if (s.opensOn) status = 'open';
  return { status, opensOn: s.opensOn ?? null, closesOn: s.closesOn ?? null, note: s.note ?? s.todo ?? null, source: 'config' };
}

async function buildResort(resort, cfg) {
  const forecastP = wrap('open-meteo', {}, () => mountainForecast(resort));
  const snotelP = resort.snotel
    ? wrap('nrcs-snotel', { stationId: resort.snotel.triplet, stationName: resort.snotel.name, distanceKm: resort.snotel.distanceKm }, () => snowDepth(resort))
    : null;
  const [forecastFull, snotel] = await Promise.all([forecastP, snotelP]);

  // Split the Open-Meteo result: the forecast part, and the modelled snowpack part.
  const { modelled, ...forecastData } = forecastFull.data ?? {};
  const forecast = { ...forecastFull, ...(forecastFull.data && { data: forecastData }) };

  // Observed snow: SNOTEL if we have a station and it answered, else the model.
  let observed = snotel;
  if (!snotel || snotel.status !== 'ok') {
    observed = forecastFull.status === 'ok'
      ? { status: 'ok', source: 'open-meteo', fetchedAt: forecastFull.fetchedAt, modelled: true,
          note: snotel ? `SNOTEL unavailable (${snotel.reason}); showing modelled values` : resort.snotelTodo,
          data: modelled }
      : snotel ?? { status: 'unavailable', source: 'open-meteo', fetchedAt: forecastFull.fetchedAt, reason: forecastFull.reason };
  }

  const item = {
    id: resort.id,
    name: resort.name,
    city: resort.city ?? null,
    region: resort.region,
    area: resort.area ?? null,
    passes: resort.passes ?? [],
    terrain: resort.terrain ?? null, // % beginner / intermediate / advanced (expert), when known
    terrainParks: resort.terrainParks ?? null, // true / false / null = unknown
    acres: resort.acres ?? null, // skiable acres: how big the mountain is
    skiersOnly: resort.skiersOnly ?? false, // no snowboarding
    lat: resort.lat,
    lon: resort.lon,
    timezone: resort.timezone,
    season: seasonStatus(resort),
    observed,
    forecast,
  };
  item.rating = rateResort(item, cfg);
  return item;
}

async function buildSpot(spot, cfg) {
  const [wv, wind, by] = await Promise.all([
    wrap('open-meteo-marine', {}, () => waves(spot, cfg.sessionHour)),
    wrap('open-meteo', {}, () => surfWind(spot, cfg.sessionHour)),
    spot.buoy
      ? wrap('noaa-ndbc', { stationId: spot.buoy.id, stationName: spot.buoy.name, distanceKm: spot.buoy.distanceKm ?? null }, () => buoy(spot.buoy.id))
      : null,
  ]);
  if (wind.status === 'ok') {
    wind.data.relative = windRelative(wind.data.directionDeg, spot.beachFacingDeg, cfg.offshoreToleranceDeg);
    for (const d of wind.data.days ?? []) d.relative = windRelative(d.deg, spot.beachFacingDeg, cfg.offshoreToleranceDeg);
  }
  const item = {
    id: spot.id,
    name: spot.name,
    city: spot.city ?? null,
    region: spot.region,
    area: spot.area ?? null,
    lat: spot.lat,
    lon: spot.lon,
    timezone: spot.timezone,
    beachFacingDeg: spot.beachFacingDeg,
    minLevel: spot.minLevel ?? null,
    minLevelNote: spot.minLevelNote ?? null,
    tideStation: spot.tideStation,
    waves: wv,
    wind,
    buoy: by,
  };
  item.rating = rateSpot(item, surfProfile(cfg, spot.area));
  return item;
}

// Surf thresholds for a region: the defaults, with that region's overrides on top
// (config/ratings.json -> surf.profiles). A good day in Hawaii is much bigger than
// a good day on the Gulf, so each region can have its own idea of "good".
function surfProfile(cfg, area) {
  const { profiles = {}, ...defaults } = cfg;
  return { ...defaults, ...(profiles[area] ?? {}) };
}

// Run fn on every item, but at most `limit` at the same time. With 40+ resorts
// this keeps us polite to the free APIs instead of firing 80 requests at once.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Collect every status in the report, so we can count failures.
function statuses(node, out = []) {
  if (node && typeof node === 'object') {
    if ('status' in node && 'source' in node && node.source !== 'config') out.push(node);
    for (const v of Object.values(node)) statuses(v, out);
  }
  return out;
}

async function main() {
  const locations = await readJSON('config/locations.json');
  const ratings = await readJSON('config/ratings.json');

  const [resorts, spots, tideList] = await Promise.all([
    mapLimit(locations.snow.resorts, 4, (r) => buildResort(r, ratings.snow)),
    mapLimit(locations.surf.spots, 4, (s) => buildSpot(s, ratings.surf)),
    // Only the tide stations that some beach actually uses, 4 at a time
    mapLimit(
      locations.surf.tideStations.filter((st) => locations.surf.spots.some((s) => s.tideStation === st.id)),
      4,
      async (st) => [st.id, await wrap('noaa-coops', { name: st.name, shortName: st.shortName ?? null, timezone: st.timezone }, () => tides(st))],
    ),
  ]);

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    units: { snow: 'in', temp: '°F', wind: 'mph', wave: 'ft', period: 's', tide: 'ft' },
    sources: SOURCES,
    verdict: null, // reserved for the optional AI morning verdict
    sections: {
      snow: {
        label: 'Snow',
        defaultPinned: locations.snow.defaultPinned ?? [],
        verdict: null,
        bestBet: bestBet(resorts, (r) => (r.observed.data?.newSnow.h48 ?? 0) + (r.forecast.data?.next72hIn ?? 0)),
        items: resorts,
      },
      surf: {
        label: 'Surf',
        defaultPinned: locations.surf.defaultPinned ?? [],
        verdict: null,
        sessionHour: ratings.surf.sessionHour,
        skills: ratings.surf.skills, // levels + boards, used by the page for "fits you"
        bestBet: bestBet(spots, ratingPeriod),
        tideStations: Object.fromEntries(tideList),
        items: spots,
      },
    },
  };

  // Safety net: if *nothing* worked (e.g. the runner lost its internet connection),
  // keep yesterday's report rather than replacing it with a page full of errors.
  const blocks = statuses(report.sections);
  const failed = blocks.filter((b) => b.status !== 'ok');
  if (failed.length === blocks.length) {
    console.error('Every source failed; leaving data/report.json unchanged.');
    process.exit(1);
  }

  await fs.mkdir(new URL('data/', root), { recursive: true });
  // Saved without indentation: with 120+ places the spaces alone would add ~40%
  // to a file every visitor downloads. (To read it, open it in VS Code and run
  // "Format Document".)
  await fs.writeFile(new URL('data/report.json', root), JSON.stringify(report) + '\n');

  // A short human-readable summary in the terminal / Action log.
  console.log(`Wrote data/report.json — ${blocks.length - failed.length}/${blocks.length} sources OK\n`);
  for (const b of failed) console.log(`  unavailable: ${b.source} ${b.stationId ?? ''} — ${b.reason}`);
  console.log('\nSNOW');
  for (const r of topFive(resorts)) console.log(`  ${r.rating.score ?? '-'}/5  ${r.name.padEnd(26)} ${r.rating.reason}`);
  console.log(`  (top 5 of ${resorts.length})`);
  console.log(`  Best bet: ${report.sections.snow.bestBet?.name ?? 'none'}`);
  console.log('\nSURF');
  for (const s of topFive(spots)) console.log(`  ${s.rating.score ?? '-'}/5  ${s.name.padEnd(26)} ${s.rating.reason}`);
  console.log(`  (top 5 of ${spots.length})`);
  console.log(`  Best bet: ${report.sections.surf.bestBet?.name ?? 'none'}`);
}

const topFive = (items) => [...items].sort((a, b) => (b.rating.score ?? 0) - (a.rating.score ?? 0)).slice(0, 5);

main();
