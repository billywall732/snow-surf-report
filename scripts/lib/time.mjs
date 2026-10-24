// Time-zone helpers. The rule for the whole project: every time we store
// carries its UTC offset, e.g. "2026-10-24T05:55-04:00", so the page never guesses.

// Minutes east of UTC for a time zone at a given instant (e.g. -420 for PDT).
function offsetMinutes(tz, ms) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
    .formatToParts(new Date(ms))
    .find((p) => p.type === 'timeZoneName').value; // "GMT-07:00" or "GMT"
  const m = name.match(/GMT([+-])(\d{2}):(\d{2})/);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// Epoch milliseconds -> "2026-10-24T05:55-07:00" in the given zone.
export function toLocalISO(ms, tz) {
  const off = offsetMinutes(tz, ms);
  const d = new Date(ms + off * 60_000); // shift, then read the UTC fields
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`
  );
}

// "2026-10-24 05:55" (a wall-clock time in tz) -> epoch milliseconds.
export function localToMs(local, tz) {
  const guess = Date.parse(local.replace(' ', 'T') + 'Z');
  let ms = guess - offsetMinutes(tz, guess) * 60_000;
  // Near a daylight-saving switch the first guess can be an hour off; correct once.
  ms = guess - offsetMinutes(tz, ms) * 60_000;
  return ms;
}

// Today's date ("YYYY-MM-DD") as seen in a time zone.
export function todayIn(tz, ms = Date.now()) {
  return toLocalISO(ms, tz).slice(0, 10);
}

// "2026-10-24" + 3 -> "2026-10-27"
export function addDays(date, n) {
  const d = new Date(date + 'T00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
