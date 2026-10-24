// Open-Meteo Marine API — modelled waves and sea temperature. Free, no key.
// If the spot's coordinates are on land, the API snaps to the nearest sea grid cell.
import { getJSON } from '../http.mjs';
import { toLocalISO } from '../time.mjs';
import { pickHour } from './open-meteo.mjs';

const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

export async function waves(spot, sessionHour) {
  const params = new URLSearchParams({
    latitude: spot.lat,
    longitude: spot.lon,
    hourly: [
      'wave_height', 'wave_period', 'wave_direction',
      'swell_wave_height', 'swell_wave_period', 'swell_wave_direction',
      'sea_surface_temperature',
    ].join(','),
    forecast_days: 1,
    length_unit: 'imperial', // wave heights in feet
    temperature_unit: 'fahrenheit',
    timezone: spot.timezone,
    timeformat: 'unixtime',
  });
  const j = await getJSON(`https://marine-api.open-meteo.com/v1/marine?${params}`);
  const h = j.hourly;
  const i = pickHour(h.time, spot.timezone, sessionHour);
  if (h.wave_height[i] == null) throw new Error('No wave data for this grid cell');
  return {
    forTime: toLocalISO(h.time[i] * 1000, spot.timezone),
    heightFt: round1(h.wave_height[i]),
    periodS: round1(h.wave_period[i]),
    directionDeg: h.wave_direction[i],
    swellHeightFt: round1(h.swell_wave_height[i]),
    swellPeriodS: round1(h.swell_wave_period[i]),
    swellDirectionDeg: h.swell_wave_direction[i],
    seaSurfaceTempF: round1(h.sea_surface_temperature[i]),
    gridPoint: { lat: j.latitude, lon: j.longitude },
    // Every hour of today, for the detail view's chart. Short keys keep the file small:
    // t = local time, ft = wave height, s = period, deg = direction waves come from.
    hourly: h.time.map((t, k) => ({
      t: toLocalISO(t * 1000, spot.timezone),
      ft: round1(h.wave_height[k]),
      s: round1(h.wave_period[k]),
      deg: h.wave_direction[k],
    })),
  };
}
