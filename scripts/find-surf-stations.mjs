// One-time helper for new surf spots. Run:  node scripts/find-surf-stations.mjs
//
// For every spot in config/locations.json it fills in whatever is missing:
//   beachFacingDeg  which way the beach faces (worked out from OpenStreetMap's coastline)
//   tideStation     nearest NOAA tide-prediction station within 60 km
//   buoy            nearest NDBC buoy within 100 km that is currently reporting waves
// Anything already set is left alone, so hand-checked values stick.
//
//   node scripts/find-surf-stations.mjs --check   recompute facing for spots that already
//                                                  have one and print the difference (no writes)
//
// How the facing direction works: OpenStreetMap draws every coastline with the
// water on the RIGHT-hand side of the line. So for each little piece of coast near
// the beach, "90° to the right of its direction" points out to sea. We average those
// directions (nearer pieces count more) to get the way the beach faces.
import fs from 'node:fs/promises';
import { getJSON, getText } from './lib/http.mjs';

// Tides change little along open coast, so a station up to 60 km away is still useful.
const TIDE_MAX_KM = 60;
const BUOY_MAX_KM = 100;
const check = process.argv.includes('--check');
const configUrl = new URL('../config/locations.json', import.meta.url);
const config = JSON.parse(await fs.readFile(configUrl, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function km(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

// ---------- Facing direction from the coastline ----------

// Ask Overpass (OpenStreetMap's query server) for the coastline around several
// beaches in ONE request: it's a free shared server and is often busy, so fewer,
// bigger requests are both faster and kinder to it.
async function coastlinesNear(spots) {
  const parts = spots.map((p) => `way(around:1500,${p.lat},${p.lon})["natural"="coastline"];`).join('');
  const query = `[out:json][timeout:120];(${parts});out geom;`;
  // Busy server (HTTP 502/504/429 or a timeout): wait and try again, longer each time.
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST', // Overpass wants the query POSTed as a form
        headers: { 'User-Agent': 'snow-surf-report setup (personal hobby project)', Accept: 'application/json' },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()).elements;
    } catch (err) {
      if (attempt === 5) throw err;
      console.log(`  (Overpass busy: ${err.message}; retrying in ${attempt * 15} s)`);
      await sleep(attempt * 15_000);
    }
  }
}

// The way a beach faces, from the coastline pieces within 1.5 km of it.
function facingFrom(ways, lat, lon) {
  // Local flat coordinates in metres: x = east, y = north
  const toXY = (p) => [(p.lon - lon) * 111320 * Math.cos((lat * Math.PI) / 180), (p.lat - lat) * 110540];
  let sx = 0;
  let sy = 0;
  for (const way of ways) {
    for (let i = 1; i < way.geometry.length; i++) {
      const [x1, y1] = toXY(way.geometry[i - 1]);
      const [x2, y2] = toXY(way.geometry[i]);
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      const dist = Math.hypot((x1 + x2) / 2, (y1 + y2) / 2);
      if (!len || dist > 1500) continue; // (the batch includes other beaches' coast too)
      const weight = len * Math.exp(-dist / 400); // nearby coast matters most
      sx += weight * (dy / len); // the right-hand normal of (dx, dy) is (dy, -dx)
      sy += weight * (-dx / len);
    }
  }
  if (!sx && !sy) return null;
  // Compass bearing: 0 = north, 90 = east
  return Math.round(((Math.atan2(sx, sy) * 180) / Math.PI + 360) % 360);
}

// Work out facing for many spots, 8 per Overpass request.
async function facingForAll(spots) {
  const result = new Map();
  for (let i = 0; i < spots.length; i += 8) {
    const batch = spots.slice(i, i + 8);
    console.log(`  coastline for ${batch.map((p) => p.name).join(', ')}...`);
    const ways = await coastlinesNear(batch);
    for (const p of batch) result.set(p.id, facingFrom(ways, p.lat, p.lon));
    await sleep(2000);
  }
  return result;
}

// ---------- Station lists ----------

const tideStations = (await getJSON('https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions')).stations;
const ndbcXml = await getText('https://www.ndbc.noaa.gov/activestations.xml');
const buoys = [...ndbcXml.matchAll(/<station ([^>]*)\/>/g)]
  .map((m) => Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1], a[2]])))
  .filter((b) => b.type === 'buoy')
  .map((b) => ({ id: b.id, name: b.name, lat: +b.lat, lon: +b.lon }));

// Is this buoy reporting wave height in the last 6 hours? (Cached: several spots share buoys.)
const buoyOk = new Map();
async function reportingWaves(id) {
  if (buoyOk.has(id)) return buoyOk.get(id);
  let ok = false;
  try {
    const lines = (await getText(`https://www.ndbc.noaa.gov/data/realtime2/${id}.txt`)).trim().split('\n');
    const header = lines[0].replace(/^#/, '').trim().split(/\s+/);
    const w = header.indexOf('WVHT');
    for (const line of lines.slice(2, 14)) {
      const c = line.trim().split(/\s+/);
      const ms = Date.UTC(c[0], c[1] - 1, c[2], c[3], c[4]);
      if (Date.now() - ms < 6 * 3600_000 && c[w] !== 'MM') { ok = true; break; }
    }
  } catch { /* no realtime file: not usable */ }
  buoyOk.set(id, ok);
  await sleep(300);
  return ok;
}

// ---------- Fill in each spot ----------

if (check) {
  const withFacing = config.surf.spots.filter((p) => p.beachFacingDeg != null);
  const auto = await facingForAll(withFacing);
  for (const spot of withFacing) {
    const a = auto.get(spot.id);
    const diff = a == null ? null : Math.abs(((a - spot.beachFacingDeg + 540) % 360) - 180);
    console.log(`${spot.name.padEnd(22)} config ${spot.beachFacingDeg}°  coastline ${a ?? '?'}°  difference ${diff ?? '?'}°`);
  }
  process.exit(0);
}

// Facing first, for every spot that needs it (in batches)
const facing = await facingForAll(config.surf.spots.filter((p) => p.beachFacingDeg == null));

for (const spot of config.surf.spots) {
  const label = spot.name.padEnd(22);
  const notes = [];
  if (facing.has(spot.id)) {
    spot.beachFacingDeg = facing.get(spot.id);
    notes.push(`faces ${spot.beachFacingDeg ?? '?'}°`);
  }
  if (spot.tideStation == null) {
    const [best] = tideStations
      .map((s) => ({ s, d: km(spot.lat, spot.lon, s.lat, s.lng) }))
      .sort((a, b) => a.d - b.d);
    if (best && best.d <= TIDE_MAX_KM) {
      spot.tideStation = best.s.id;
      if (!config.surf.tideStations.some((t) => t.id === best.s.id)) {
        config.surf.tideStations.push({ id: best.s.id, name: best.s.state ? `${best.s.name}, ${best.s.state}` : best.s.name, timezone: spot.timezone });
      }
      notes.push(`tide ${best.s.id} ${best.s.name} (${best.d.toFixed(1)} km)`);
    } else {
      notes.push('NO tide station within range');
    }
  }
  if (!('buoy' in spot)) {
    const near = buoys
      .map((b) => ({ b, d: km(spot.lat, spot.lon, b.lat, b.lon) }))
      .filter((x) => x.d <= BUOY_MAX_KM)
      .sort((a, b) => a.d - b.d)
      .slice(0, 5);
    spot.buoy = null;
    for (const { b, d } of near) {
      if (await reportingWaves(b.id)) {
        spot.buoy = { id: b.id, name: b.name.replace(/\s*\(\d+\)$/, ''), distanceKm: Math.round(d) };
        break;
      }
    }
    notes.push(spot.buoy ? `buoy ${spot.buoy.id} ${spot.buoy.name} (${spot.buoy.distanceKm} km)` : 'no reporting buoy nearby');
  }
  if (notes.length) console.log(`${label} ${notes.join(' | ')}`);
}

await fs.writeFile(configUrl, JSON.stringify(config, null, 2) + '\n');
console.log('\nUpdated config/locations.json');
