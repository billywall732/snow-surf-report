// Open-Meteo Forecast API (https://open-meteo.com/) — free, no key, non-commercial use.
// We ask for US units and "unixtime" timestamps (seconds since 1970, no time-zone guessing).
import { getJSON } from '../http.mjs';
import { toLocalISO } from '../time.mjs';

const BASE = 'https://api.open-meteo.com/v1/forecast';
const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

// Mountain forecast for a resort: 7 daily rows, plus modelled snow depth and
// snowfall for the past 10 days (used when there's no SNOTEL station nearby).
export async function mountainForecast(resort) {
  const params = new URLSearchParams({
    latitude: resort.lat,
    longitude: resort.lon,
    daily: 'snowfall_sum,temperature_2m_max,temperature_2m_min,wind_speed_10m_max,wind_gusts_10m_max',
    hourly: 'snowfall,snow_depth,apparent_temperature',
    past_days: 10,
    forecast_days: 7,
    precipitation_unit: 'inch',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    timezone: resort.timezone,
    timeformat: 'unixtime',
  });
  // Optional: base elevation corrects temperature for altitude. Without it,
  // Open-Meteo uses the terrain height at the coordinates.
  if (resort.baseElevationFt) params.set('elevation', Math.round(resort.baseElevationFt * 0.3048));
  const j = await getJSON(`${BASE}?${params}`);
  const tz = resort.timezone;
  const now = Date.now() / 1000;
  const today = toLocalISO(Date.now(), tz).slice(0, 10);

  // Daily rows: keep today and the 6 days after it.
  const days = j.daily.time
    .map((t, i) => ({
      date: toLocalISO(t * 1000, tz).slice(0, 10),
      snowfall: round1(j.daily.snowfall_sum[i]),
      tempHigh: Math.round(j.daily.temperature_2m_max[i]),
      tempLow: Math.round(j.daily.temperature_2m_min[i]),
      windMax: Math.round(j.daily.wind_speed_10m_max[i]),
      gustMax: Math.round(j.daily.wind_gusts_10m_max[i]),
    }))
    .filter((d) => d.date >= today);

  const h = j.hourly;
  // "Feels like" (wind chill) on the slopes: the coldest and warmest hour between
  // 9 AM and 4 PM local time, for each day. Used for what to wear.
  for (const d of days) {
    const lifts = h.time
      .map((t, i) => ({ local: toLocalISO(t * 1000, tz), f: h.apparent_temperature[i] }))
      .filter((x) => x.local.slice(0, 10) === d.date && Number(x.local.slice(11, 13)) >= 9 && Number(x.local.slice(11, 13)) <= 16 && x.f != null)
      .map((x) => x.f);
    d.feelsLow = lifts.length ? Math.round(Math.min(...lifts)) : null;
    d.feelsHigh = lifts.length ? Math.round(Math.max(...lifts)) : null;
  }

  // Hourly snowfall: add up the past 24h / 48h / 7d and the next 72h.
  const sumSnow = (from, to) =>
    round1(h.time.reduce((s, t, i) => (t > from && t <= to ? s + (h.snowfall[i] ?? 0) : s), 0));

  // Snow depth comes back in feet (or metres if the API ever changes); convert to inches.
  const depthFactor = j.hourly_units.snow_depth === 'ft' ? 12 : 39.37;
  const depthAt = (i) => (h.snow_depth[i] == null ? null : Math.round(h.snow_depth[i] * depthFactor));
  const nowIdx = h.time.findLastIndex((t) => t <= now);
  const depthHistory = h.time
    .map((t, i) => ({ t, i, local: toLocalISO(t * 1000, tz) }))
    .filter((x) => x.local.slice(11, 16) === '00:00' && x.t <= now) // local midnight readings
    .slice(-10)
    .map((x) => ({ date: x.local.slice(0, 10), depth: depthAt(x.i) }));

  return {
    days,
    next72hIn: sumSnow(now, now + 72 * 3600),
    modelled: {
      depthNow: depthAt(nowIdx),
      newSnow: {
        h24: sumSnow(now - 24 * 3600, now),
        h48: sumSnow(now - 48 * 3600, now),
        d7: sumSnow(now - 7 * 24 * 3600, now),
      },
      depthHistory,
    },
  };
}

// Wind at a surf spot for the morning session hour (e.g. 7 AM local), plus the
// air temperature then and the day's highest UV index (same request).
export async function surfWind(spot, sessionHour) {
  const params = new URLSearchParams({
    latitude: spot.lat,
    longitude: spot.lon,
    hourly: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m',
    daily: 'uv_index_max,temperature_2m_max',
    forecast_days: 3, // today + 2 more, for alerts about upcoming waves
    wind_speed_unit: 'mph',
    temperature_unit: 'fahrenheit',
    timezone: spot.timezone,
    timeformat: 'unixtime',
  });
  const j = await getJSON(`${BASE}?${params}`);
  const i = pickHour(j.hourly.time, spot.timezone, sessionHour);
  return {
    forTime: toLocalISO(j.hourly.time[i] * 1000, spot.timezone),
    speedMph: Math.round(j.hourly.wind_speed_10m[i]),
    gustMph: Math.round(j.hourly.wind_gusts_10m[i]),
    directionDeg: j.hourly.wind_direction_10m[i],
    airTempF: Math.round(j.hourly.temperature_2m[i]), // at the session hour
    airHighF: Math.round(j.daily.temperature_2m_max[0]),
    uvIndexMax: round1(j.daily.uv_index_max[0]), // today's peak (around midday)
    // Every hour of TODAY: t = local time, mph = speed, gust, deg = direction wind comes from
    hourly: j.hourly.time
      .map((t, k) => ({ t: toLocalISO(t * 1000, spot.timezone), mph: Math.round(j.hourly.wind_speed_10m[k]), gust: Math.round(j.hourly.wind_gusts_10m[k]), deg: j.hourly.wind_direction_10m[k] }))
      .filter((p) => p.t.slice(0, 10) === toLocalISO(j.hourly.time[i] * 1000, spot.timezone).slice(0, 10)),
    // The session hour on each of the 3 days
    days: j.hourly.time
      .map((t, k) => ({ t, k }))
      .filter(({ t }) => Number(toLocalISO(t * 1000, spot.timezone).slice(11, 13)) === sessionHour)
      .map(({ t, k }) => ({ date: toLocalISO(t * 1000, spot.timezone).slice(0, 10), mph: Math.round(j.hourly.wind_speed_10m[k]), deg: j.hourly.wind_direction_10m[k] })),
  };
}

// Index of the hourly row whose local hour equals `hour`.
export function pickHour(times, tz, hour) {
  const i = times.findIndex((t) => Number(toLocalISO(t * 1000, tz).slice(11, 13)) === hour);
  if (i === -1) throw new Error(`No forecast row for ${hour}:00`);
  return i;
}
