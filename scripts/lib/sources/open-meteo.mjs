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
    elevation: Math.round(resort.baseElevationFt * 0.3048), // metres; corrects temperature for altitude
    daily: 'snowfall_sum,temperature_2m_max,temperature_2m_min,wind_speed_10m_max,wind_gusts_10m_max',
    hourly: 'snowfall,snow_depth',
    past_days: 10,
    forecast_days: 7,
    precipitation_unit: 'inch',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    timezone: resort.timezone,
    timeformat: 'unixtime',
  });
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

  // Hourly snowfall: add up the past 24h / 48h / 7d and the next 72h.
  const h = j.hourly;
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

// Wind at a surf spot for the morning session hour (e.g. 7 AM local).
export async function surfWind(spot, sessionHour) {
  const params = new URLSearchParams({
    latitude: spot.lat,
    longitude: spot.lon,
    hourly: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    forecast_days: 1,
    wind_speed_unit: 'mph',
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
  };
}

// Index of the hourly row whose local hour equals `hour`.
export function pickHour(times, tz, hour) {
  const i = times.findIndex((t) => Number(toLocalISO(t * 1000, tz).slice(11, 13)) === hour);
  if (i === -1) throw new Error(`No forecast row for ${hour}:00`);
  return i;
}
