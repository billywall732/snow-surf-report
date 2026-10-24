// NOAA National Data Buoy Center — observed waves and water temperature.
// The "realtime2" files are plain text: two header lines, then one row per
// observation, newest first. Missing values are written as "MM".
import { getText } from '../http.mjs';

const M_TO_FT = 3.28084;
const cToF = (c) => Math.round((c * 9 / 5 + 32) * 10) / 10;

export async function buoy(id) {
  const text = await getText(`https://www.ndbc.noaa.gov/data/realtime2/${id}.txt`);
  const lines = text.trim().split('\n');
  const header = lines[0].replace(/^#/, '').trim().split(/\s+/);
  const rows = lines.slice(2).slice(0, 12).map((line) => {
    const cells = line.trim().split(/\s+/);
    const row = Object.fromEntries(header.map((h, i) => [h, cells[i] === 'MM' ? null : cells[i]]));
    row.ms = Date.UTC(row.YY, row.MM - 1, row.DD, row.hh, row.mm); // buoy times are UTC
    return row;
  });

  // Not every row has every value; use the newest row that has a wave height.
  const wave = rows.find((r) => r.WVHT != null);
  const temp = rows.find((r) => r.WTMP != null);
  if (!wave && !temp) throw new Error('No recent observations');
  if (wave && Date.now() - wave.ms > 6 * 3600_000) throw new Error('Latest reading is over 6 hours old');

  return {
    observedAt: new Date((wave ?? temp).ms).toISOString(),
    waveHeightFt: wave ? Math.round(wave.WVHT * M_TO_FT * 10) / 10 : null,
    dominantPeriodS: wave?.DPD != null ? Number(wave.DPD) : null,
    meanDirectionDeg: wave?.MWD != null ? Number(wave.MWD) : null,
    waterTempF: temp ? cToF(Number(temp.WTMP)) : null,
  };
}
