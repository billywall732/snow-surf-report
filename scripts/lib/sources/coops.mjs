// NOAA CO-OPS Tides & Currents API — tide predictions. Free, no key.
// Docs: https://api.tidesandcurrents.noaa.gov/api/prod/
//
// We ask only for the high/low predictions ("hilo"), because "subordinate" stations
// like Manasquan Inlet don't offer anything else. To draw a smooth curve we fill in
// the gaps with a half cosine wave between each low and high — the same shape
// NOAA itself uses for subordinate stations.
import { getJSON } from '../http.mjs';
import { addDays, localToMs, todayIn, toLocalISO } from '../time.mjs';

export async function tides(station) {
  const tz = station.timezone;
  const today = todayIn(tz);
  const compact = (d) => d.replaceAll('-', '');
  const params = new URLSearchParams({
    product: 'predictions',
    station: station.id,
    begin_date: compact(addDays(today, -1)),
    end_date: compact(addDays(today, 1)),
    datum: 'MLLW', // heights relative to "mean lower low water", the usual chart zero
    time_zone: 'lst_ldt', // station's local time, daylight-saving aware
    units: 'english',
    interval: 'hilo',
    format: 'json',
    application: 'snow-surf-report',
  });
  const j = await getJSON(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?${params}`);
  if (j.error) throw new Error(j.error.message);

  const all = j.predictions.map((p) => ({
    ms: localToMs(p.t, tz),
    type: p.type, // "H" or "L"
    ft: Number(p.v),
  }));

  const dayStart = localToMs(`${today} 00:00`, tz);
  const dayEnd = localToMs(`${addDays(today, 1)} 00:00`, tz);

  // Curve: one point every 30 minutes across today.
  const curve = [];
  for (let ms = dayStart; ms <= dayEnd; ms += 30 * 60_000) {
    const k = all.findIndex((e) => e.ms > ms);
    if (k < 1) continue;
    const a = all[k - 1];
    const b = all[k];
    const frac = (ms - a.ms) / (b.ms - a.ms);
    const ft = (a.ft + b.ft) / 2 + ((a.ft - b.ft) / 2) * Math.cos(Math.PI * frac);
    curve.push({ t: toLocalISO(ms, tz), ft: Math.round(ft * 100) / 100 });
  }

  // Events: today's highs/lows plus a margin on each side, so the page can always
  // find the "next" high and low even late in the evening.
  const events = all
    .filter((e) => e.ms >= dayStart - 12 * 3600_000 && e.ms <= dayEnd + 12 * 3600_000)
    .map((e) => ({ t: toLocalISO(e.ms, tz), type: e.type, ft: e.ft }));

  return {
    date: today,
    datum: 'MLLW',
    curveMethod: 'Cosine interpolation between NOAA high/low predictions',
    events,
    curve,
  };
}
