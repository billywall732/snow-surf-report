// The emails people get: a snow alert, a surf alert, a weekly "nothing hit your
// thresholds" digest, and the "confirm your address" email. Each is { subject, text, html }.
//
// Every email answers one question first: go or not, where, and when. Then each place
// gets a card with only the facts that change that decision (what to bring, how
// windy, which board), each one labelled with the day it's about.
//
// Email apps are much pickier than browsers: layout uses tables, every style is
// written on the element itself (plus a small <style> block that only adds dark-mode
// colors for apps that support it), and there are no web fonts, scripts or SVG.
// Widths top out at 600px and shrink on phones. Every icon is an emoji with a text
// label next to it, and the one image (the site's icon) has alt text, so the email
// reads the same with images blocked. No tracking pixels.
import { withinReach, normalizeRider } from '../../js/recommend.js';

const BRAND = 'Snow & Surf Report';
// The site's own icon as a PNG (email apps drop SVG), hosted with the site
const LOGO = 'https://offthewall.dev/snow-surf-report/icon-email.png';
const COLORS = {
  snow: { main: '#0f6f86', deep: '#0a4f60', light: '#e6f3f6', name: 'Snow' },
  surf: { main: '#1f63c6', deep: '#16478f', light: '#e8f0fb', name: 'Surf' },
  plain: { main: '#1d2733', deep: '#121a23', light: '#eef1f5', name: '' },
};
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const INK = '#16202b';
const INK_2 = '#4b5866';
const MUTED = '#6b7785';
const RULE = '#e3e8ee';
// One icon per kind of information, always shown with its label. Waves and tides
// have different icons so a quick scan can't mix them up.
const ICON = {
  snow: '❄️', surf: '🏄', wind: '💨', temp: '🌡️', tide: '🌙', waves: '🌊', period: '⏱️', water: '🩱',
  buoy: '🛟', board: '🏄', base: '🏔️', season: '🗓️', pass: '🎟️', fresh: '❄️', date: '📅',
};
// The decision, from the 1-5 rating: 4-5 go, 3 worth a look, 1-2 only if you're desperate.
// A mountain that isn't open yet is never a "go", whatever its numbers.
// short: the word on the small pills in the glance box (narrow phone column)
const VERDICT = {
  go: { label: 'GO', short: 'GO', color: '#0b7a5a', soft: '#e3f4ee' },
  maybe: { label: 'WORTH A LOOK', short: 'MAYBE', color: '#a35f00', soft: '#fbf0de' },
  skip: { label: 'ONLY IF DESPERATE', short: 'SKIP', color: '#5f6b78', soft: '#eef1f4' },
  closed: { label: 'NOT OPEN YET', short: 'NOT OPEN', color: '#5f6b78', soft: '#eef1f4' },
};

export const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const firstName = (user) => (user.name ? user.name.trim().split(/\s+/)[0] : '');
const place = (item) => (item.city ? `${item.city}, ${item.region}` : item.region);
const dayShort = (date) => new Date(`${date}T12:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
const dayLong = (date) => new Date(`${date}T12:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
const monthDay = (date) => new Date(`${date}T12:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const nextDate = (date) => new Date(Date.parse(`${date}T12:00Z`) + 86400e3).toISOString().slice(0, 10);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const stars = (score) => '★'.repeat(score) + '☆'.repeat(5 - score);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const ok = (b) => b?.status === 'ok';
// An icon and its label: "❄️ Snow". The emoji is decoration; the word carries the meaning.
const iconLabel = (key, label) => `<span style="font-size:15px;" aria-hidden="true">${ICON[key]}</span>&nbsp;${escape(label)}`;

// 8-point compass from degrees (where wind or swell comes FROM)
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compass = (deg) => (deg == null ? '' : COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]);
// 7 -> "7am", 12 -> "noon", 15 -> "3pm"
const hourText = (h) => (h === 12 ? 'noon' : h === 0 || h === 24 ? 'midnight' : h < 12 ? `${h}am` : `${h - 12}pm`);
const hourRange = (a, b) => {
  if (b === 12) return `${hourText(a)}–noon`;
  const sameHalf = (a < 12) === (b < 12) && a !== 12;
  return sameHalf ? `${a > 12 ? a - 12 : a}–${hourText(b)}` : `${hourText(a)}–${hourText(b)}`;
};

export function verdictOf(score, closed = false) {
  if (closed) return { key: 'closed', ...VERDICT.closed };
  if (score == null) return { key: 'skip', ...VERDICT.skip, label: 'CHECK', short: 'CHECK' };
  const key = score >= 4 ? 'go' : score === 3 ? 'maybe' : 'skip';
  return { key, ...VERDICT[key] };
}
const verdictText = (v, score, short = false) => {
  const word = short ? v.short : v.label;
  return v.key === 'closed' || score == null ? word : `${word} · ${score}/5`;
};

// Why the rating is what it is. A 1-3 always explains itself (the reason, plus what pulled
// it down), so a big number with a low rating is never left unexplained. A 4-5 only says
// what held it back, if anything: its reason would just repeat the conditions.
function ratingWhy(rating) {
  if (!rating?.reason) return '';
  const minus = (rating.factors ?? []).filter((f) => /^-/.test(f)).map((f) => f.replace(/^-\d+\s*/, ''));
  const held = minus.length ? `held back by ${minus.join(', ')}` : '';
  if ((rating.score ?? 0) >= 4) return held;
  return [rating.reason, held].filter(Boolean).join(' · ');
}

// ---------- Surf facts, in plain English ----------

// "11 s" means nothing on its own: say what it does to the waves
export function periodMeaning(s) {
  if (s == null) return '';
  if (s >= 12) return 'long-period groundswell: more power, cleaner lines';
  if (s >= 9) return 'mid-period swell: decent shape';
  return 'short-period windswell: weaker, choppier waves';
}
const swellKind = (s) => (s >= 12 ? 'groundswell' : s >= 9 ? 'swell' : 'windswell');

// What to wear for the water temperature (°F)
export function wetsuit(f) {
  if (f == null) return '';
  if (f >= 75) return 'trunks';
  if (f >= 70) return 'trunks or a 2mm top';
  if (f >= 65) return '2mm springsuit or 3/2';
  if (f >= 60) return '3/2 full suit';
  if (f >= 55) return '4/3 full suit';
  if (f >= 50) return '4/3 with booties';
  return '5/4 with hood, booties and gloves';
}

// "2.4 ft @ 7 s W windswell + 1.4 ft @ 13 s W groundswell": the swells biggest-period first
export function swellLine(day) {
  const parts = [day.sw2, day.sw, day.ww].filter((p) => p && p[0] >= 0.5);
  if (!parts.length) return day.ft != null ? `${day.ft} ft @ ${Math.round(day.s)} s ${compass(day.deg)}`.trim() : '';
  return parts
    .sort((a, b) => b[1] - a[1])
    .map(([ft, s, deg], i, all) => `${ft} ft @ ${Math.round(s)} s ${compass(deg)} ${all[i] === day.ww ? 'wind chop' : swellKind(s)}`.replace(/\s+/g, ' '))
    .join(' + ');
}
// The longest-period swell that actually matters, for "W swell" in the verdict
function mainSwell(day) {
  const parts = [day.sw2, day.sw].filter((p) => p && p[0] >= 0.5).sort((a, b) => b[1] - a[1]);
  return parts[0] ?? (day.deg != null ? [day.ft, day.s, day.deg] : null);
}

// "Cleanest 5am–noon, onshore after noon"
export function windowText(win) {
  if (!win) return '';
  const turn = win.badFrom != null ? `${win.badRel ?? 'windy'} after ${hourText(win.badFrom)}` : '';
  if (win.from != null) return [`cleanest ${hourRange(win.from, win.to)}`, turn].filter(Boolean).join(', ');
  return win.badFrom != null ? `wind-affected from ${hourText(win.badFrom)}` : 'breezy but workable all day';
}

// The tide highs and lows on one day, in order, with heights: "Low 1:38 PM (0.5 ft) · High 7:40 PM (2.0 ft)"
export function tidesOn(station, date) {
  if (!ok(station) || !station.data?.events?.length) return null;
  const tz = station.timezone || 'UTC';
  const localDate = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: tz });
  const at = (t) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
  const list = station.data.events
    .filter((e) => localDate(e.t) === date)
    .sort((a, b) => Date.parse(a.t) - Date.parse(b.t))
    .map((e) => `${e.type === 'H' ? 'High' : 'Low'} ${at(e.t)} (${e.ft.toFixed(1)} ft)`);
  return list.length ? list.join(' · ') : null;
}

// Ground truth from the nearest buoy, only if it reported in the last 6 hours
function buoyLine(spot) {
  if (!ok(spot.buoy)) return null;
  const b = spot.buoy.data;
  if (!b.observedAt || Date.now() - Date.parse(b.observedAt) > 6 * 3600e3) return null;
  const bits = [
    b.waveHeightFt != null ? `${b.waveHeightFt} ft` : null,
    b.dominantPeriodS != null ? `@ ${b.dominantPeriodS} s` : null,
    b.meanDirectionDeg != null ? `from ${compass(b.meanDirectionDeg)}` : null,
  ].filter(Boolean).join(' ');
  return bits ? `${bits} (${spot.buoy.stationName})` : null;
}

// Which of YOUR boards this day suits, and why: "Fits your longboard and mid-length (3.1 ft)"
function boardLine(day, profile, skills) {
  const boards = profile?.boards ?? [];
  if (!boards.length || !skills?.boards || day?.ft == null) return null;
  const fits = [], misses = [];
  for (const key of boards) {
    const b = skills.boards[key];
    if (!b) continue;
    const name = b.label.toLowerCase().split(' / ')[0];
    if (day.ft < b.minFt) misses.push(`too small for your ${name}`);
    else if (day.ft > b.maxFt) misses.push(`too big for your ${name}`);
    else if (b.minPeriodS && day.s < b.minPeriodS) misses.push(`period too short for your ${name}`);
    else fits.push(name);
  }
  const join = (l) => (l.length > 1 ? `${l.slice(0, -1).join(', ')} and ${l.at(-1)}` : l[0]);
  return [fits.length ? `Your ${join(fits)} (${day.ft} ft is in range)` : null, misses.length ? cap(join(misses)) : null].filter(Boolean).join('. ');
}

// ---------- Snow facts ----------

const isClosed = (r) => r.season?.status === 'closed';
// "Open" / "Opens Nov 13" / "Closed for the season" / "Opening date not set"
export function seasonText(r) {
  const s = r.season ?? {};
  if (s.status === 'open') return 'Open';
  // Closed before opening day (opensOn still ahead) vs. after the season ended
  if (s.status === 'closed' && s.opensOn && !(s.closesOn && s.closesOn < new Date().toISOString().slice(0, 10))) return `Not open yet: opens ${monthDay(s.opensOn)}`;
  if (s.status === 'closed') return 'Closed for the season';
  return 'Opening date not set';
}
const passText = (r) => (r.passes ?? []).map((p) => `${p.pass}${p.access ? ` (${p.access.toLowerCase()})` : ''}`).join(' · ');

// The day to ride and why: snow that falls in the evening is the NEXT morning's powder.
// -> { rideDate, text: 'Sat: 7" overnight' }
function snowBest(p, firstDate) {
  const days = p.coming?.days ?? [];
  const forecast = ok(p.item.forecast) ? p.item.forecast.data.days : [];
  const top = days.reduce((m, d) => (d.inches > (m?.inches ?? 0) ? d : m), null);
  if (top) {
    const f = forecast.find((d) => d.date === top.date);
    const [am, day, pm] = f?.snowParts ?? [top.inches, 0, 0];
    if (pm > am + day) return { rideDate: nextDate(top.date), text: `${dayLong(nextDate(top.date))} morning, after ${top.inches}" ${dayShort(top.date)} evening` };
    return { rideDate: top.date, text: `${top.date === firstDate ? 'today' : dayLong(top.date)}, ${top.inches}" ${am >= day ? 'overnight' : 'during the day'}` };
  }
  const obs = ok(p.item.observed) ? p.item.observed.data : null;
  return { rideDate: firstDate, text: `today, ${obs?.newSnow?.h48 ?? '?'}" fell in the last 48 hours` };
}

// ---------- Building blocks ----------

// Dark mode: apps that support it (Apple Mail, iOS Mail, Outlook.com) swap these colors in.
// Gmail ignores the block and darkens the light design itself; the light colors were
// chosen to survive that.
const DARK_CSS = `
:root { color-scheme: light dark; supported-color-schemes: light dark; }
@media (prefers-color-scheme: dark) {
  .ssr-page { background: #0f141a !important; }
  .ssr-card, .ssr-panel { background: #161d25 !important; border-color: #2a3440 !important; }
  .ssr-glance { background: #1a2430 !important; }
  .ssr-ink { color: #e8edf2 !important; }
  .ssr-ink2 { color: #b9c4cf !important; }
  .ssr-muted { color: #8f9aa6 !important; }
  .ssr-rule { border-color: #2a3440 !important; }
  .ssr-track { background: #243040 !important; }
  .ssr-accent { color: #8fc8ff !important; }
}`;

// The page every email sits in: the inbox preview line, a header band (icon, brand,
// what this is, the decision badge, the date), a short greeting, the glance box,
// the cards and the footer.
function shell({ kind = 'plain', preheader, kicker, title, badge, dateLabel, intro, glance, body, footer }) {
  const c = COLORS[kind];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escape(title)}</title>
<style>${DARK_CSS}</style>
</head>
<body class="ssr-page" style="margin:0;padding:0;background:#eef1f5;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#eef1f5;">${escape(preheader)}&#8203;&#8199;&#8203;&#8199;&#8203;&#8199;&#8203;&#8199;</div>
<table role="presentation" class="ssr-page" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef1f5;">
  <tr><td align="center" style="padding:20px 10px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
      <tr><td class="ssr-card" style="background:#ffffff;border:1px solid ${RULE};border-radius:14px;overflow:hidden;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="background:${c.main};background-image:linear-gradient(135deg,${c.main},${c.deep});padding:20px 24px 22px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              <td style="vertical-align:middle;padding-right:10px;"><img src="${LOGO}" width="32" height="32" alt="${BRAND} icon" style="display:block;width:32px;height:32px;border:0;border-radius:8px;background:#ffffff;color:#ffffff;font:600 10px ${FONT};"></td>
              <td style="vertical-align:middle;font:700 14px/1.3 ${FONT};color:#ffffff;letter-spacing:.02em;">${BRAND}</td>
            </tr></table>
            ${kicker ? `<div style="margin-top:16px;font:700 12px/1.4 ${FONT};color:#ffffff;opacity:.9;letter-spacing:.1em;text-transform:uppercase;">${kicker}</div>` : ''}
            <div style="margin-top:4px;font:800 24px/1.25 ${FONT};color:#ffffff;">${escape(title)}</div>
            ${badge ? `<div style="margin-top:10px;"><span style="display:inline-block;padding:5px 11px;border-radius:999px;background:${badge.color};border:2px solid #ffffff;font:800 13px/1.2 ${FONT};color:#ffffff;letter-spacing:.06em;">${escape(badge.text)}</span></div>` : ''}
            ${dateLabel ? `<div style="margin-top:10px;font:14px/1.4 ${FONT};color:#ffffff;opacity:.9;">${iconLabel('date', dateLabel)}</div>` : ''}
          </td></tr>
          ${intro ? `<tr><td class="ssr-ink" style="padding:20px 24px 2px;font:15px/1.55 ${FONT};color:${INK};">${intro}</td></tr>` : ''}
          ${glance ? `<tr><td style="padding:14px 24px 4px;">${glance}</td></tr>` : ''}
          <tr><td style="padding:14px 24px 22px;">${body}</td></tr>
        </table>
      </td></tr>
      <tr><td class="ssr-muted" style="padding:18px 10px 0;font:13px/1.6 ${FONT};color:${MUTED};text-align:center;">${footer}</td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function button(href, label, color) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:8px;background:${color};">
    <a href="${escape(href)}" style="display:inline-block;padding:11px 20px;font:600 15px/1.2 ${FONT};color:#ffffff;text-decoration:none;border-radius:8px;">${escape(label)}</a>
  </td></tr></table>`;
}

function pill(v, score, small = false) {
  return `<span style="display:inline-block;padding:${small ? '3px 7px' : '4px 9px'};border-radius:6px;background:${v.color};font:800 ${small ? 10 : 11}px/1.2 ${FONT};color:#ffffff;letter-spacing:.05em;white-space:nowrap;">${escape(verdictText(v, score, small))}</span>`;
}

// "Conditions at a glance": the decision for every place, in ranked order, with the
// day or window to go. Most people only read this box.
// rows: [{ group?, v, score, name, headline, when }]
function glanceBox(kind, rows) {
  const c = COLORS[kind];
  let lastGroup = null;
  const out = [];
  rows.forEach((r, i) => {
    if (r.group && r.group !== lastGroup) {
      out.push(`<tr><td colspan="2" class="ssr-muted" style="padding:${i ? 12 : 2}px 16px 2px;font:700 11px/1.4 ${FONT};color:${MUTED};letter-spacing:.08em;text-transform:uppercase;">${escape(r.group)}</td></tr>`);
      lastGroup = r.group;
    }
    out.push(`<tr>
      <td style="padding:9px 0 9px 16px;vertical-align:top;width:1%;${i ? `border-top:1px solid ${RULE};` : ''}" class="ssr-rule">${pill(r.v, r.score, true)}</td>
      <td style="padding:8px 16px 8px 10px;vertical-align:top;${i ? `border-top:1px solid ${RULE};` : ''}" class="ssr-rule">
        <div class="ssr-ink" style="font:700 15px/1.35 ${FONT};color:${INK};">${escape(r.name)} <span class="ssr-accent" style="font-weight:600;color:${c.main};white-space:nowrap;">${escape(r.headline)}</span></div>
        ${r.when ? `<div class="ssr-ink2" style="margin-top:1px;font:13px/1.45 ${FONT};color:${INK_2};">${escape(r.when)}</div>` : ''}
      </td>
    </tr>`);
  });
  return `<table role="presentation" class="ssr-glance" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${c.light};border-radius:10px;">
    <tr><td colspan="2" class="ssr-accent" style="padding:13px 16px 4px;font:700 12px/1.4 ${FONT};color:${c.deep};letter-spacing:.08em;text-transform:uppercase;">Conditions at a glance</td></tr>
    ${out.join('')}
    <tr><td colspan="2" style="height:8px;line-height:8px;font-size:0;">&nbsp;</td></tr>
  </table>`;
}

// The days ahead as bars sized to the value, so 7 inches looks bigger than 1.
// cells: [{ top: 'Sat', value: 7.2, label: '7.2"', on: true }]
function barStrip(cells, c) {
  if (!cells.length) return '';
  const max = Math.max(...cells.map((x) => x.value || 0), 0.1);
  const H = 44;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;">
    <tr>${cells.map((x) => `<td style="vertical-align:bottom;text-align:center;padding:0 6px 0 0;width:46px;">
      <div class="${x.on ? 'ssr-accent' : 'ssr-ink2'}" style="font:700 12px/1.2 ${FONT};color:${x.on ? c.main : INK_2};margin-bottom:3px;">${escape(x.label)}</div>
      <div style="height:${Math.round(H - Math.max(2, (x.value || 0) / max * H))}px;line-height:0;font-size:0;">&nbsp;</div>
      <div style="height:${Math.max(2, Math.round((x.value || 0) / max * H))}px;line-height:0;font-size:0;border-radius:4px 4px 0 0;background:${x.on ? c.main : '#c5ced8'};">&nbsp;</div>
    </td>`).join('')}</tr>
    <tr>${cells.map((x) => `<td class="ssr-muted" style="padding:4px 6px 0 0;text-align:center;font:600 11px/1.2 ${FONT};color:${MUTED};text-transform:uppercase;letter-spacing:.03em;">${escape(x.top)}</td>`).join('')}</tr>
  </table>`;
}

// Labeled facts, one per line so they never squeeze on a phone: [[iconKey, label, value], ...]
function factList(facts) {
  if (!facts.length) return '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="ssr-rule" style="margin-top:14px;border-top:1px solid ${RULE};">
    ${facts.map(([key, label, value]) => `<tr>
      <td class="ssr-muted" style="padding:7px 10px 7px 0;font:14px/1.45 ${FONT};color:${MUTED};white-space:nowrap;vertical-align:top;width:1%;">${iconLabel(key, label)}</td>
      <td class="ssr-ink" style="padding:7px 0;font:600 14px/1.45 ${FONT};color:${INK};vertical-align:top;">${escape(value)}</td>
    </tr>`).join('')}
  </table>`;
}

// One place: its badge, name, rating with the reason, the verdict, the bars, the facts and a button
function placeCard({ c, kind, item, v, link, verdict, strip, facts, cta, top }) {
  const score = item.rating?.score;
  return `<table role="presentation" class="ssr-panel" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;background:#ffffff;border:1px solid ${RULE};border-top:4px solid ${v.color};border-radius:10px;">
    <tr><td style="padding:16px 18px 18px;">
      <div>${pill(v, score)}${top ? `<span class="ssr-muted" style="margin-left:8px;font:700 11px/1.2 ${FONT};color:${MUTED};letter-spacing:.06em;text-transform:uppercase;">Top pick</span>` : ''}</div>
      <a href="${escape(link)}" class="ssr-ink" style="display:block;margin-top:8px;font:800 20px/1.3 ${FONT};color:${INK};text-decoration:none;">${escape(item.name)}</a>
      <div class="ssr-muted" style="margin-top:1px;font:14px/1.5 ${FONT};color:${MUTED};">${escape(place(item))}</div>
      ${score != null ? `<div class="ssr-ink2" style="margin-top:6px;font:13px/1.5 ${FONT};color:${INK_2};"><span style="color:#c48a00;letter-spacing:1px;">${stars(score)}</span> <b class="ssr-ink" style="color:${INK};">${score}/5 today</b>${ratingWhy(item.rating) ? ` — ${escape(ratingWhy(item.rating))}` : ''}</div>` : ''}
      <div class="ssr-ink" style="margin-top:12px;font:700 17px/1.4 ${FONT};color:${INK};">${verdict}</div>
      ${strip}
      ${factList(facts)}
      <div style="margin-top:16px;">${button(link, cta, kind === 'snow' ? COLORS.snow.main : COLORS.surf.main)}</div>
    </td></tr>
  </table>`;
}

// What this email is and the link to change it. (No separate "unsubscribe" link: the
// alerts page is where you turn them off, and a link labelled Unsubscribe should
// unsubscribe in one tap, which a static site can't do yet.)
function footerHtml(manage, what) {
  return `${escape(what)} It isn’t a marketing email.<br>
    <a href="${escape(manage)}" style="color:${INK_2};text-decoration:underline;">Manage alerts</a> (turn them off, or change places and thresholds)<br>
    <span style="color:#9aa4ae;">${BRAND} · Conditions are forecasts, not guarantees. Check before you go.</span>`;
}
const footerText = (manage, what) => `${what} It isn't a marketing email.\nManage alerts (turn them off, or change places and thresholds): ${manage}\nConditions are forecasts, not guarantees. Check before you go.`;

// Local first, then places they watch for trips; best first inside each group. Never
// drops a place: with no home set (or "any distance") it's one ranked list. Places that
// can't be ridden yet (a mountain before opening day) always go last, in their own group,
// so they can never lead the email.
function rankAndGroup(list, rider, rank, notYet = () => false) {
  const r = normalizeRider(rider);
  const grouping = Boolean(r.home && r.radiusMi);
  const sorted = [...list].sort(rank);
  const ready = sorted.filter((x) => !notYet(x));
  const later = sorted.filter(notYet);
  let out;
  if (!grouping) out = ready.map((x) => ({ ...x, group: null }));
  else {
    const near = ready.filter((x) => withinReach(x.item, r)).map((x) => ({ ...x, group: 'Near you' }));
    const far = ready.filter((x) => !withinReach(x.item, r)).map((x) => ({ ...x, group: near.length ? 'Worth the trip' : null }));
    out = [...near, ...far];
  }
  const labelLater = out.length > 0 || grouping;
  return [...out, ...later.map((x) => ({ ...x, group: labelLater ? 'Not open yet' : null }))];
}

// ---------- Snow alert ----------
// alerts: snow alerts from computeAlerts(); items: id -> mountain from the report

export function snowEmail({ user, alerts, items, siteUrl, dateLabel, lookAhead }) {
  const c = COLORS.snow;
  // One card per mountain (a mountain can have both "coming" and "fresh")
  const byPlace = new Map();
  for (const a of alerts) {
    const entry = byPlace.get(a.itemId) ?? { item: items.get(a.itemId), coming: null, fresh: null };
    if (a.id.startsWith('fresh:')) entry.fresh = a;
    else entry.coming = a;
    byPlace.set(a.itemId, entry);
  }
  const amount = (p) => {
    const coming = p.coming ? Number(p.coming.title.match(/([\d.]+)"/)?.[1] ?? 0) : 0;
    const fresh = p.fresh ? Number(p.fresh.title.match(/([\d.]+)"/)?.[1] ?? 0) : 0;
    return Math.max(coming, fresh);
  };
  // By rating, then by inches; mountains that aren't open yet go last
  const places = rankAndGroup([...byPlace.values()].filter((p) => p.item), user.rider,
    (a, b) => (b.item.rating?.score ?? 0) - (a.item.rating?.score ?? 0) || amount(b) - amount(a), (p) => isClosed(p.item));
  for (const p of places) {
    const firstDate = ok(p.item.forecast) ? p.item.forecast.data.days[0]?.date : null;
    p.best = snowBest(p, firstDate);
    p.v = verdictOf(p.item.rating?.score, isClosed(p.item));
    // '10.5" by Sat' / '8" fresh in 48h'
    const snowy = (p.coming?.days ?? []).filter((d) => d.inches > 0);
    p.headline = p.coming ? `${p.coming.title.match(/([\d.]+)"/)[1]}" by ${dayShort(snowy.at(-1)?.date ?? p.coming.days.at(-1).date)}` : `${p.fresh.title.match(/([\d.]+)"/)[1]}" fresh in 48h`;
  }
  const top = places[0];
  const score = (p) => p.item.rating?.score;
  const rated = (p) => (score(p) != null ? ` (rated ${score(p)}/5)` : '');
  const subject = `Snow alert: ${top.item.name}${places.length > 1 ? ` + ${places.length - 1} more` : ''}, ${top.headline}${rated(top)}`;
  const name = firstName(user);

  const cards = places.map((p, i) => {
    const r = p.item;
    const link = `${siteUrl}#snow/${r.id}`;
    const obs = ok(r.observed) ? r.observed.data : null;
    const forecast = ok(r.forecast) ? r.forecast.data.days : [];
    const ride = forecast.find((d) => d.date === p.best.rideDate) ?? forecast[0];
    const rideLabel = ride ? (ride.date === forecast[0]?.date ? 'Today' : dayShort(ride.date)) : '';
    const days = forecast.slice(0, lookAhead);
    const closed = isClosed(r);
    const verdict = closed
      ? `${escape(seasonText(r))}. This snow builds the base for opening day; it isn't rideable yet.`
      : `Best day: ${escape(p.best.text)}${ride?.feelsLow != null ? `, feels like ${ride.feelsLow}°` : ''}${obs?.depthNow != null ? `, base ${obs.depthNow}"` : ''}`;
    return placeCard({
      c, kind: 'snow', item: r, v: p.v, link, top: i === 0,
      verdict,
      strip: barStrip(days.map((d) => ({ top: d.date === forecast[0]?.date ? 'Today' : dayShort(d.date), value: d.snowfall ?? 0, label: `${d.snowfall ?? 0}"`, on: (d.snowfall ?? 0) > 0 && d.snowfall === Math.max(...days.map((x) => x.snowfall ?? 0)) })), c),
      facts: [
        ['season', 'Season', seasonText(r)],
        obs ? ['fresh', 'Fresh snow', `${obs.newSnow.h24}" last 24h · ${obs.newSnow.h48}" last 48h`] : null,
        obs?.depthNow != null ? ['base', 'Base', `${obs.depthNow}"${r.observed.modelled ? ' (modelled, no snow station nearby)' : ''}`] : null,
        ride ? ['temp', `${rideLabel} temp`, `High ${ride.tempHigh}°, low ${ride.tempLow}°F${ride.feelsLow != null ? ` · feels like ${ride.feelsLow}° on the lifts` : ''}`] : null,
        ride?.windMax != null ? ['wind', `${rideLabel} wind`, `${ride.windDeg != null ? `${compass(ride.windDeg)} ` : ''}${ride.windMax} mph${ride.gustMax != null ? `, gusts ${ride.gustMax}` : ''}`] : null,
        r.passes?.length ? ['pass', 'Pass', passText(r)] : null,
      ].filter(Boolean),
      cta: closed ? `See ${r.name}'s opening outlook →` : `See ${rideLabel === 'Today' ? 'today' : dayLong(ride?.date ?? forecast[0].date)} at ${r.name} →`,
    });
  }).join('');

  const intro = `<p style="margin:0;">${name ? `Good morning, ${escape(name)}.` : 'Good morning.'} <span class="ssr-ink2" style="color:${INK_2};">${places.length === 1 ? 'One of your mountains matches' : `${plural(places.length, 'mountain')} match`} your snow alert, best first.</span></p>`;
  const what = `This is your daily snow alert from ${BRAND}: you turned on snow alerts, looking ${lookAhead} days ahead, and these mountains matched.`;
  const glanceWhen = (p) => (isClosed(p.item) ? seasonText(p.item) : `Best: ${p.best.text}`);
  const html = shell({
    kind: 'snow',
    preheader: `${top.v.label}: ${top.item.name}${isClosed(top.item) ? '' : `. Best day: ${top.best.text}`}${places.length > 1 ? `. ${plural(places.length - 1, 'more mountain')} inside.` : '.'}`,
    kicker: `${ICON.snow} Snow alert`,
    title: `Best bet: ${top.item.name}`,
    badge: { text: verdictText(top.v, score(top)), color: top.v.color },
    dateLabel,
    intro,
    glance: glanceBox('snow', places.map((p) => ({ group: p.group, v: p.v, score: score(p), name: p.item.name, headline: p.headline, when: glanceWhen(p) }))),
    body: cards,
    footer: footerHtml(`${siteUrl}#alerts`, what),
  });
  const text = [
    `${BRAND}: SNOW ALERT for ${dateLabel}`,
    `${verdictText(top.v, score(top))}: best bet is ${top.item.name}`,
    '',
    'CONDITIONS AT A GLANCE',
    ...places.map((p) => `- [${verdictText(p.v, score(p))}] ${p.item.name}: ${p.headline}. ${glanceWhen(p)}${p.group ? ` (${p.group.toLowerCase()})` : ''}`),
    '',
    ...places.map((p) => {
      const r = p.item;
      const obs = ok(r.observed) ? r.observed.data : null;
      const forecast = ok(r.forecast) ? r.forecast.data.days : [];
      const ride = forecast.find((d) => d.date === p.best.rideDate) ?? forecast[0];
      const rideLabel = ride ? (ride.date === forecast[0]?.date ? 'Today' : dayShort(ride.date)) : '';
      return [
        `${r.name} (${place(r)}) [${verdictText(p.v, score(p))}]`,
        ratingWhy(r.rating) ? `  Rated ${score(p)}/5 today: ${ratingWhy(r.rating)}` : null,
        isClosed(r) ? `  ${seasonText(r)}. Not rideable yet.` : `  Best day: ${p.best.text}${ride?.feelsLow != null ? `, feels like ${ride.feelsLow}°` : ''}${obs?.depthNow != null ? `, base ${obs.depthNow}"` : ''}`,
        `  Snow by day: ${forecast.slice(0, lookAhead).map((d) => `${dayShort(d.date)} ${d.snowfall ?? 0}"`).join(', ')}`,
        `  Season: ${seasonText(r)}`,
        obs ? `  Fresh snow: ${obs.newSnow.h24}" last 24h, ${obs.newSnow.h48}" last 48h` : null,
        obs?.depthNow != null ? `  Base: ${obs.depthNow}"${r.observed.modelled ? ' (modelled)' : ''}` : null,
        ride ? `  ${rideLabel} temp: high ${ride.tempHigh}°, low ${ride.tempLow}°F${ride.feelsLow != null ? `, feels like ${ride.feelsLow}°` : ''}` : null,
        ride?.windMax != null ? `  ${rideLabel} wind: ${ride.windDeg != null ? `${compass(ride.windDeg)} ` : ''}${ride.windMax} mph${ride.gustMax != null ? `, gusts ${ride.gustMax}` : ''}` : null,
        r.passes?.length ? `  Pass: ${passText(r)}` : null,
        `  ${siteUrl}#snow/${r.id}`,
      ].filter(Boolean).join('\n');
    }),
    '',
    footerText(`${siteUrl}#alerts`, what),
  ].join('\n');
  return { subject, text, html };
}

// ---------- Surf alert ----------

export function surfEmail({ user, alerts, items, siteUrl, dateLabel, lookAhead, profileText, tides = {}, skills }) {
  const c = COLORS.surf;
  const profile = user.profile ?? { levels: [], boards: [] };
  const list = alerts.map((a) => ({ a, item: items.get(a.itemId) })).filter((x) => x.item);
  const ft = (x) => x.a.days[0].ft;
  const spots = rankAndGroup(list, user.rider, (a, b) => (b.item.rating?.score ?? 0) - (a.item.rating?.score ?? 0) || ft(b) - ft(a));
  for (const x of spots) {
    const d0 = x.a.days[0];
    const waveDays = ok(x.item.waves) ? x.item.waves.data.days ?? [] : [];
    const windDays = ok(x.item.wind) ? x.item.wind.data.days ?? [] : [];
    x.waveDay = waveDays.find((d) => d.date === d0.date) ?? { ft: d0.ft, s: d0.s };
    x.windDay = windDays.find((d) => d.date === d0.date) ?? null;
    x.when = d0.when; // 'today' / 'Sat'
    x.v = verdictOf(x.item.rating?.score);
    x.headline = `${d0.ft} ft @ ${Math.round(d0.s)} s ${d0.when}`;
    const sw = mainSwell(x.waveDay);
    const win = windowText(x.windDay?.window);
    const day = x.when === 'today' ? 'today' : dayLong(d0.date);
    const w = x.windDay?.window;
    x.windowLine = `${cap(day)}: ${win || `${d0.wind?.relative ?? ''} wind`}`.replace(/: $/, '');
    // "Best window: today 5am–noon, offshore, W groundswell. Onshore after noon."
    const swellBit = sw ? `, ${compass(sw[2])} ${swellKind(sw[1])}` : '';
    if (w?.from != null) {
      const windBit = x.windDay?.relative === 'offshore' ? 'offshore' : 'light wind';
      const turn = w.badFrom != null ? ` ${cap(w.badRel ?? 'windy')} after ${hourText(w.badFrom)}.` : '';
      x.verdict = `Best window: ${day} ${hourRange(w.from, w.to)}, ${windBit}${swellBit}.${turn}`;
    } else {
      x.verdict = `Best bet: ${day}${swellBit}. ${cap(win || 'check the wind before you go')}.`;
    }
  }
  const top = spots[0];
  const score = (s) => s.item.rating?.score;
  const rated = (s) => (score(s) != null ? ` (rated ${score(s)}/5)` : '');
  const subject = `Surf alert: ${top.item.name}${spots.length > 1 ? ` + ${spots.length - 1} more` : ''}, ${top.headline}${rated(top)}`;
  const name = firstName(user);

  const facts = (x) => {
    const d0 = x.a.days[0];
    const label = x.when === 'today' ? 'Today' : dayShort(d0.date);
    const buoy = buoyLine(x.item);
    // The buoy's measured water temperature when it's fresh, else the model's
    const buoyWater = buoy && ok(x.item.buoy) ? x.item.buoy.data.waterTempF : null;
    const water = buoyWater ?? (ok(x.item.waves) ? x.item.waves.data.seaSurfaceTempF : null);
    const wind = x.windDay;
    const main = mainSwell(x.waveDay);
    return [
      ['waves', `${label} waves`, swellLine(x.waveDay)],
      main ? ['period', 'Period', `${Math.round(main[1])} s — ${periodMeaning(main[1])}`] : null,
      wind ? ['wind', `${label} ${hourText(Number(x.item.wind.data.forTime?.slice(11, 13) ?? 7))}`, `${compass(wind.deg)} ${wind.mph} mph${wind.gust != null ? `, gusts ${wind.gust}` : ''} (${wind.relative})`] : null,
      tidesOn(tides[x.item.tideStation], d0.date) ? ['tide', `${label} tides`, tidesOn(tides[x.item.tideStation], d0.date)] : null,
      x.when === 'today' && buoy ? ['buoy', 'Buoy now', buoy] : null,
      water != null ? ['water', 'Wetsuit', `${Math.round(water)}°F water${buoyWater != null ? ' (buoy)' : ''} — ${wetsuit(water)}`] : null,
      wind?.airHigh != null ? ['temp', `${label} air`, `High ${wind.airHigh}°F`] : null,
      boardLine(x.waveDay, profile, skills) ? ['board', 'Board', boardLine(x.waveDay, profile, skills)] : null,
    ].filter(Boolean);
  };

  const cards = spots.map((x, i) => {
    const link = `${siteUrl}#surf/${x.item.id}`;
    const goodDates = new Set(x.a.days.map((d) => d.date));
    const allDays = (ok(x.item.waves) ? x.item.waves.data.days ?? [] : []).slice(0, lookAhead);
    const first = allDays[0]?.date;
    return placeCard({
      c, kind: 'surf', item: x.item, v: x.v, link, top: i === 0,
      verdict: escape(x.verdict),
      strip: barStrip(allDays.map((d) => ({ top: d.date === first ? 'Today' : dayShort(d.date), value: d.ft ?? 0, label: `${d.ft} ft`, on: goodDates.has(d.date) })), c),
      facts: facts(x),
      cta: `See ${x.when === 'today' ? "today's window" : `${dayLong(x.a.days[0].date)}`} at ${x.item.name} →`,
    });
  }).join('');

  const who = profileText ? `${/^[aeiou]/i.test(profileText) ? 'an' : 'a'} ${escape(profileText)}` : 'you';
  const intro = `<p style="margin:0;">${name ? `Good morning, ${escape(name)}.` : 'Good morning.'} <span class="ssr-ink2" style="color:${INK_2};">${spots.length === 1 ? 'One of your beaches has' : `${plural(spots.length, 'beach', 'beaches')} have`} waves that fit ${who} in the next ${lookAhead} days, best first. Blue bars are days that fit.</span></p>`;
  const what = `This is your daily surf alert from ${BRAND}: you turned on surf alerts, looking ${lookAhead} days ahead, and these beaches matched.`;
  const html = shell({
    kind: 'surf',
    preheader: `${top.v.label}: ${top.item.name}. ${top.windowLine}${spots.length > 1 ? `. ${plural(spots.length - 1, 'more beach', 'more beaches')} inside.` : '.'}`,
    kicker: `${ICON.surf} Surf alert`,
    title: `Best bet: ${top.item.name}`,
    badge: { text: verdictText(top.v, score(top)), color: top.v.color },
    dateLabel,
    intro,
    glance: glanceBox('surf', spots.map((x) => ({ group: x.group, v: x.v, score: score(x), name: x.item.name, headline: x.headline, when: x.windowLine }))),
    body: cards,
    footer: footerHtml(`${siteUrl}#alerts`, what),
  });
  const text = [
    `${BRAND}: SURF ALERT for ${dateLabel}`,
    `${verdictText(top.v, score(top))}: best bet is ${top.item.name}`,
    '',
    'CONDITIONS AT A GLANCE',
    ...spots.map((x) => `- [${verdictText(x.v, score(x))}] ${x.item.name}: ${x.headline}. ${x.windowLine}${x.group ? ` (${x.group.toLowerCase()})` : ''}`),
    '',
    ...spots.map((x) => [
      `${x.item.name} (${place(x.item)}) [${verdictText(x.v, score(x))}]`,
      ratingWhy(x.item.rating) ? `  Rated ${score(x)}/5 today: ${ratingWhy(x.item.rating)}` : null,
      `  ${x.verdict}`,
      `  Waves by day: ${(ok(x.item.waves) ? x.item.waves.data.days : []).slice(0, lookAhead).map((d) => `${dayShort(d.date)} ${d.ft} ft`).join(', ')} (fits you: ${x.a.days.map((d) => d.when).join(', ')})`,
      ...facts(x).map(([, label, value]) => `  ${label}: ${value}`),
      `  ${siteUrl}#surf/${x.item.id}`,
    ].filter(Boolean).join('\n')),
    '',
    footerText(`${siteUrl}#alerts`, what),
  ].join('\n');
  return { subject, text, html };
}

// ---------- Flat week: the weekly heartbeat ----------
// Sent when nothing has matched for a week (or to a new subscriber who hasn't had
// anything yet), so silence never means "is this thing on?".
// watched: { snow: [{ item }], surf: [{ item, fits }] } from watching() in alert-rules.js

export function digestEmail({ user, watched, siteUrl, dateLabel, firstOne = false }) {
  const c = COLORS.plain;
  // The best of the next 7 days at each place: the snowiest day, or the biggest day that fits
  const snow = watched.snow.map(({ item }) => {
    const days = ok(item.forecast) ? item.forecast.data.days.slice(0, 7) : [];
    const best = days.reduce((m, d) => ((d.snowfall ?? 0) > (m?.snowfall ?? 0) ? d : m), null);
    return { name: item.name, link: `${siteUrl}#snow/${item.id}`, closed: isClosed(item), line: isClosed(item) ? seasonText(item) : best ? `Most snow: ${best.snowfall}" ${dayLong(best.date)}` : 'No snow in the 7-day forecast', value: best?.snowfall ?? 0 };
  }).sort((a, b) => Number(a.closed) - Number(b.closed) || b.value - a.value);
  const surf = watched.surf.map(({ item, best }) => ({
    name: item.name, link: `${siteUrl}#surf/${item.id}`,
    line: best ? `Biggest day that fits you: ${best.ft} ft @ ${Math.round(best.s)} s ${dayLong(best.date)}` : 'Nothing that fits you in the 7-day forecast',
    value: best?.ft ?? 0,
  })).sort((a, b) => b.value - a.value);
  const lead = [...snow.slice(0, 1).filter((x) => x.value > 0), ...surf.slice(0, 1).filter((x) => x.value > 0)][0];
  const subject = firstOne
    ? `You're set up: watching ${plural(snow.length + surf.length, 'place')}`
    : `Nothing hit your thresholds this week${lead ? ` · best ahead: ${lead.name}` : ''}`;
  const name = firstName(user);
  // The 8 best of each kind; the rest as a count (every place is still on the alerts page)
  const SHOW = 8;
  const more = (rows) => (rows.length > SHOW ? `+ ${plural(rows.length - SHOW, 'more place')} on your alerts page` : '');
  const section = (label, rows, key) => (rows.length ? `
    <div class="ssr-muted" style="margin:14px 0 4px;font:700 12px/1.4 ${FONT};color:${MUTED};letter-spacing:.08em;text-transform:uppercase;">${iconLabel(key, label)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.slice(0, SHOW).map((r) => `<tr><td class="ssr-rule" style="padding:8px 0;border-top:1px solid ${RULE};">
      <a href="${escape(r.link)}" class="ssr-ink" style="font:700 15px/1.4 ${FONT};color:${INK};text-decoration:none;">${escape(r.name)}</a>
      <div class="ssr-ink2" style="font:13px/1.45 ${FONT};color:${INK_2};">${escape(r.line)}</div>
    </td></tr>`).join('')}${more(rows) ? `<tr><td class="ssr-muted" style="padding:8px 0;border-top:1px solid ${RULE};font:13px/1.45 ${FONT};color:${MUTED};">${escape(more(rows))}</td></tr>` : ''}</table>` : '');
  const what = firstOne
    ? `You turned on alerts at ${BRAND}. Alerts only arrive on mornings something matches your thresholds; if nothing does for a week, you'll get a short note like this instead.`
    : `This is the weekly note from ${BRAND}: nothing matched your alert thresholds in the past week, so here's the week ahead instead.`;
  const html = shell({
    kind: 'plain',
    preheader: firstOne ? 'Alerts are on. Here is what you are watching.' : `Quiet week. ${lead ? `Best ahead: ${lead.name}, ${lead.line.charAt(0).toLowerCase()}${lead.line.slice(1)}.` : 'Nothing big in the forecast.'}`,
    kicker: firstOne ? 'Alerts are on' : 'Weekly check-in',
    title: firstOne ? `Watching ${plural(snow.length + surf.length, 'place')} for you` : 'Nothing hit your thresholds this week',
    dateLabel,
    intro: `<p style="margin:0;">${name ? `Hi ${escape(name)}.` : 'Hi.'} <span class="ssr-ink2" style="color:${INK_2};">${firstOne ? 'Your alerts are working. When something matches, it lands here in the morning.' : 'Best of the next 7 days at the places you watch:'}</span></p>`,
    body: `${section('Mountains', snow, 'snow')}${section('Beaches', surf, 'surf')}<div style="margin-top:18px;">${button(`${siteUrl}#alerts`, 'Manage alerts', c.main)}</div>`,
    footer: footerHtml(`${siteUrl}#alerts`, what),
  });
  const text = [
    `${BRAND}: ${firstOne ? 'ALERTS ARE ON' : 'WEEKLY CHECK-IN'} for ${dateLabel}`,
    '',
    firstOne ? 'Your alerts are working. When something matches, it lands here in the morning.' : 'Nothing hit your thresholds this week. Best of the next 7 days at the places you watch:',
    ...(snow.length ? ['', 'MOUNTAINS', ...snow.slice(0, SHOW).map((r) => `- ${r.name}: ${r.line}`), more(snow)].filter(Boolean) : []),
    ...(surf.length ? ['', 'BEACHES', ...surf.slice(0, SHOW).map((r) => `- ${r.name}: ${r.line}`), more(surf)].filter(Boolean) : []),
    '',
    footerText(`${siteUrl}#alerts`, what),
  ].join('\n');
  return { subject, text, html };
}

// ---------- Confirm a new address ----------

export function confirmationEmail({ user, link }) {
  const name = firstName(user);
  const subject = 'Confirm your email for Snow & Surf alerts';
  const html = shell({
    kind: 'plain',
    preheader: 'One tap to start getting alerts at this address.',
    kicker: 'Confirm your email',
    title: 'Get your alerts here?',
    intro: `<p style="margin:0 0 6px;">${name ? `Hi ${escape(name)},` : 'Hi,'}</p>
      <p class="ssr-ink2" style="margin:0;color:${INK_2};">Tap the button to send your Snow &amp; Surf Report alerts to this address.</p>`,
    body: `<div style="margin:8px 0 6px;">${button(link, 'Confirm my email', COLORS.plain.main)}</div>
      <p class="ssr-muted" style="margin:16px 0 0;font:13px/1.6 ${FONT};color:${MUTED};">Or copy this link into your browser:<br><span style="word-break:break-all;">${escape(link)}</span></p>`,
    footer: `If you didn't ask for this, you can ignore this email and nothing will be sent here.<br><span style="color:#9aa4ae;">${BRAND}</span>`,
  });
  const text = `${name ? `Hi ${name},` : 'Hi,'}\n\nTap this link to get Snow & Surf Report alerts at this address:\n\n${link}\n\nIf you didn't ask for this, ignore this email and nothing will be sent here.`;
  return { subject, text, html };
}
