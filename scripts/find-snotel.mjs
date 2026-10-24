// One-time helper: pick the nearest SNOTEL station for new resorts.
// Run:  node scripts/find-snotel.mjs
//
// For every resort in config/locations.json that has NO "snotel" key yet, this
// finds the closest active NRCS SNOTEL station. If one is within MAX_KM it is
// written into the config; otherwise "snotel" is set to null and the report
// uses Open-Meteo's modelled snow depth instead. Resorts that already have a
// "snotel" key (a station or null) are left alone, so hand-picked choices stick.
//
// Always look over the result: the nearest station can be on the wrong side of
// a ridge or far above/below the ski area.
import fs from 'node:fs/promises';
import { getJSON } from './lib/http.mjs';

const MAX_KM = 30;
const configUrl = new URL('../config/locations.json', import.meta.url);
const config = JSON.parse(await fs.readFile(configUrl, 'utf8'));
const todo = config.snow.resorts.filter((r) => !('snotel' in r));
if (!todo.length) {
  console.log('Every resort already has a "snotel" entry. Nothing to do.');
  process.exit(0);
}

// SNOTEL stations only exist in the western US and Alaska, so ask for those states.
const states = ['AK', 'AZ', 'CA', 'CO', 'ID', 'MT', 'NM', 'NV', 'OR', 'SD', 'UT', 'WA', 'WY'];
const params = new URLSearchParams({
  stationTriplets: states.map((s) => `*:${s}:SNTL`).join(','),
  returnForecastPointMetadata: 'false',
  returnReservoirMetadata: 'false',
  returnStationElements: 'false',
});
const stations = (await getJSON(`https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/stations?${params}`))
  .filter((s) => s.endDate.startsWith('2100')); // still active

// Great-circle distance in km (the "haversine" formula)
function km(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

for (const resort of todo) {
  const [best] = stations
    .map((s) => ({ s, d: km(resort.lat, resort.lon, s.latitude, s.longitude) }))
    .sort((a, b) => a.d - b.d);
  if (best && best.d <= MAX_KM) {
    resort.snotel = {
      triplet: best.s.stationTriplet,
      name: best.s.name,
      distanceKm: Math.round(best.d * 10) / 10,
      note: `Auto-picked: nearest active SNOTEL, ${Math.round(best.s.elevation).toLocaleString('en-US')} ft.`,
    };
    console.log(`${resort.name.padEnd(28)} ${best.s.stationTriplet.padEnd(14)} ${best.s.name} (${resort.snotel.distanceKm} km, ${best.s.elevation} ft)`);
  } else {
    resort.snotel = null;
    resort.snotelTodo = best
      ? `Nearest SNOTEL is ${Math.round(best.d)} km away; using Open-Meteo's modelled snow depth.`
      : 'No SNOTEL stations in this region; using Open-Meteo\'s modelled snow depth.';
    console.log(`${resort.name.padEnd(28)} (none within ${MAX_KM} km${best ? `; nearest ${Math.round(best.d)} km` : ''}) -> modelled`);
  }
}

await fs.writeFile(configUrl, JSON.stringify(config, null, 2) + '\n');
console.log(`\nUpdated ${todo.length} resort(s) in config/locations.json`);
