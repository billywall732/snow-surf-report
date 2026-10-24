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
    region: resort.region,
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
      ? wrap('noaa-ndbc', { stationId: spot.buoy.id, stationName: spot.buoy.name }, () => buoy(spot.buoy.id))
      : null,
  ]);
  if (wind.status === 'ok') {
    wind.data.relative = windRelative(wind.data.directionDeg, spot.beachFacingDeg, cfg.offshoreToleranceDeg);
  }
  const item = {
    id: spot.id,
    name: spot.name,
    region: spot.region,
    lat: spot.lat,
    lon: spot.lon,
    timezone: spot.timezone,
    beachFacingDeg: spot.beachFacingDeg,
    tideStation: spot.tideStation,
    waves: wv,
    wind,
    buoy: by,
  };
  item.rating = rateSpot(item, cfg);
  return item;
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
    Promise.all(locations.snow.resorts.map((r) => buildResort(r, ratings.snow))),
    Promise.all(locations.surf.spots.map((s) => buildSpot(s, ratings.surf))),
    Promise.all(locations.surf.tideStations.map(async (st) => [
      st.id,
      await wrap('noaa-coops', { name: st.name, shortName: st.shortName, timezone: st.timezone }, () => tides(st)),
    ])),
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
        verdict: null,
        bestBet: bestBet(resorts, (r) => (r.observed.data?.newSnow.h48 ?? 0) + (r.forecast.data?.next72hIn ?? 0)),
        items: resorts,
      },
      surf: {
        label: 'Surf',
        verdict: null,
        sessionHour: ratings.surf.sessionHour,
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
  await fs.writeFile(new URL('data/report.json', root), JSON.stringify(report, null, 2) + '\n');

  // A short human-readable summary in the terminal / Action log.
  console.log(`Wrote data/report.json — ${blocks.length - failed.length}/${blocks.length} sources OK\n`);
  for (const b of failed) console.log(`  unavailable: ${b.source} ${b.stationId ?? ''} — ${b.reason}`);
  console.log('\nSNOW');
  for (const r of resorts) console.log(`  ${r.rating.score ?? '-'}/5  ${r.name.padEnd(24)} ${r.rating.reason}`);
  console.log(`  Best bet: ${report.sections.snow.bestBet?.name ?? 'none'}`);
  console.log('\nSURF');
  for (const s of spots) console.log(`  ${s.rating.score ?? '-'}/5  ${s.name.padEnd(24)} ${s.rating.reason}`);
  console.log(`  Best bet: ${report.sections.surf.bestBet?.name ?? 'none'}`);
}

main();
