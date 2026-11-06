// The emails people get: a snow alert, a surf alert, a weekly "nothing hit your
// thresholds" digest, and the "confirm your address" email. Each is { subject, text, html }.
//
// Every email answers one question first: go or not, where, and when. The header is
// two lines (the decision, then the date); the glance box lists every place in ranked
// order; then one card per place with only the facts that change the decision. Facts
// that are the same at every place (same coast, same tides) are printed once.
//
// Design rules: content, not banners (no colored header band, no logo up top); one
// verdict badge per email, in the header; no ALL CAPS labels; no boxes around
// sections, just one rule above the glance box and one above each card.
//
// Email apps are pickier than browsers: layout uses tables, styles are written on the
// elements, and a small <style> block adds what inline styles can't: the phone layout
// (max-width 480px: Gmail and Apple Mail on iOS/Android honor it) and dark-mode colors.
// Every icon is an emoji with a text label. No images, no tracking pixels.
import { withinReach, normalizeRider } from '../../js/recommend.js';

const BRAND = 'Snow & Surf Report';
const ACCENT = { snow: '#0f6f86', surf: '#1f63c6', plain: '#1d2733' };
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const INK = '#16202b';
const INK_2 = '#4b5866';
const MUTED = '#6b7785';
const RULE = '#dfe5eb';
// One icon per kind of information, always with its label. Waves and tides differ.
const ICON = {
  snow: '❄️', surf: '🏄', wind: '💨', temp: '🌡️', tide: '🌙', waves: '🌊', period: '⏱️', water: '🩱',
  buoy: '🛟', board: '🏄', base: '🏔️', season: '🗓️', pass: '🎟️', fresh: '❄️', quiet: '🌤️', ok: '✅',
};

// ---------- The verdict ----------
// One label per rating band, the same word everywhere it appears (email and site):
// 4-5 GO, 3 WORTH A LOOK, 1-2 SKIP. A place that can't be ridden yet is NOT OPEN YET.
export const VERDICT = {
  go: { label: 'GO', color: '#0b7a5a' },
  maybe: { label: 'WORTH A LOOK', color: '#a35f00' },
  skip: { label: 'SKIP', color: '#5f6b78' },
  closed: { label: 'NOT OPEN YET', color: '#5f6b78' },
};
export function verdictOf(score, notYet = false) {
  if (notYet) return { key: 'closed', ...VERDICT.closed };
  if (score == null) return { key: 'skip', ...VERDICT.skip };
  const key = score >= 4 ? 'go' : score === 3 ? 'maybe' : 'skip';
  return { key, ...VERDICT[key] };
}

export const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const firstName = (user) => (user.name ? user.name.trim().split(/\s+/)[0] : '');
const place = (item) => (item.city ? `${item.city}, ${item.region}` : item.region);
const dayShort = (date) => new Date(`${date}T12:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
const dayLong = (date) => new Date(`${date}T12:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
const monthDay = (date) => new Date(`${date}T12:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const nextDate = (date) => new Date(Date.parse(`${date}T12:00Z`) + 86400e3).toISOString().slice(0, 10);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const stars = (score) => '★'.repeat(score) + '☆'.repeat(5 - score);
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const ok = (b) => b?.status === 'ok';
const iconLabel = (key, label) => `<span aria-hidden="true">${ICON[key]}</span>&nbsp;${escape(label)}`;
const lookText = (n) => (n >= 7 ? 'this week' : `in the next ${n} days`);

// 8-point compass from degrees (where wind or swell comes FROM)
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compass = (deg) => (deg == null ? '' : COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]);
const hourText = (h) => (h === 12 ? 'noon' : h === 0 || h === 24 ? 'midnight' : h < 12 ? `${h}am` : `${h - 12}pm`);
const hourRange = (a, b) => {
  if (b === 12) return `${hourText(a)}–noon`;
  const sameHalf = (a < 12) === (b < 12) && a !== 12;
  return sameHalf ? `${a > 12 ? a - 12 : a}–${hourText(b)}` : `${hourText(a)}–${hourText(b)}`;
};

// Why the rating is what it is. A 1-3 always explains itself, so a big number with a
// low rating is never left unexplained. A 4-5 only says what held it back, if anything.
function ratingWhy(rating) {
  if (!rating?.reason) return '';
  const minus = (rating.factors ?? []).filter((f) => /^-/.test(f)).map((f) => f.replace(/^-\d+\s*/, ''));
  const held = minus.length ? `held back by ${minus.join(', ')}` : '';
  if ((rating.score ?? 0) >= 4) return held;
  return [rating.reason, held].filter(Boolean).join(' · ');
}

// ---------- Surf facts, in plain English ----------

export function periodMeaning(s) {
  if (s == null) return '';
  if (s >= 12) return 'long-period groundswell: more power, cleaner lines';
  if (s >= 9) return 'mid-period swell: decent shape';
  return 'short-period windswell: weaker, choppier waves';
}
const swellKind = (s) => (s >= 12 ? 'groundswell' : s >= 9 ? 'swell' : 'windswell');

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

// "1.4 ft @ 13 s W groundswell + 2.4 ft @ 7 s W windswell", longest period first
export function swellLine(day) {
  const parts = [day.sw2, day.sw, day.ww].filter((p) => p && p[0] >= 0.5);
  if (!parts.length) return day.ft != null ? `${day.ft} ft @ ${Math.round(day.s)} s ${compass(day.deg)}`.trim() : '';
  return parts
    .sort((a, b) => b[1] - a[1])
    .map((p) => `${p[0]} ft @ ${Math.round(p[1])} s ${compass(p[2])} ${p === day.ww ? 'wind chop' : swellKind(p[1])}`.replace(/\s+/g, ' '))
    .join(' + ');
}
function mainSwell(day) {
  const parts = [day.sw2, day.sw].filter((p) => p && p[0] >= 0.5).sort((a, b) => b[1] - a[1]);
  return parts[0] ?? (day.deg != null ? [day.ft, day.s, day.deg] : null);
}

// "cleanest 5am–noon, onshore after noon"
export function windowText(win) {
  if (!win) return '';
  const turn = win.badFrom != null ? `${win.badRel ?? 'windy'} after ${hourText(win.badFrom)}` : '';
  if (win.from != null) return [`cleanest ${hourRange(win.from, win.to)}`, turn].filter(Boolean).join(', ');
  return win.badFrom != null ? `wind-affected from ${hourText(win.badFrom)}` : 'breezy but workable all day';
}

// One day's highs and lows, in order, with heights. `next` marks the ones still to come
// (on today's card), so the phone layout can show just the next two.
export function tidesOn(station, date) {
  if (!ok(station) || !station.data?.events?.length) return [];
  const tz = station.timezone || 'UTC';
  const localDate = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: tz });
  const at = (t) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
  return station.data.events
    .filter((e) => localDate(e.t) === date)
    .sort((a, b) => Date.parse(a.t) - Date.parse(b.t))
    .map((e) => ({ text: `${e.type === 'H' ? 'High' : 'Low'} ${at(e.t)} (${e.ft.toFixed(1)} ft)`, next: Date.parse(e.t) > Date.now() }));
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

// Which of YOUR boards this day suits: "Your longboard (3.1 ft is in range)"
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
const baseOf = (r) => (ok(r.observed) ? r.observed.data.depthNow : null);
// Can you ride it at all? Not before opening day, and not on a 0" base.
const rideable = (r) => !isClosed(r) && baseOf(r) !== 0;
export function seasonText(r) {
  const s = r.season ?? {};
  if (s.status === 'open') return 'Open';
  if (s.status === 'closed' && s.opensOn && !(s.closesOn && s.closesOn < new Date().toISOString().slice(0, 10))) return `Opens ${monthDay(s.opensOn)}`;
  if (s.status === 'closed') return 'Closed for the season';
  return 'Opening date not set';
}
const passText = (r) => (r.passes ?? []).map((p) => `${p.pass}${p.access ? ` (${p.access.toLowerCase()})` : ''}`).join(' · ');

// The day to ride and why: snow that falls in the evening is the NEXT morning's powder.
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

// Local first, then trip spots; best first in each. Places that can't be ridden yet
// always go last, so they never lead. Never drops a place.
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
  return [...out, ...later.map((x) => ({ ...x, group: out.length || grouping ? 'Not rideable yet' : null }))];
}

// ---------- Building blocks ----------

// The phone layout and dark mode, for the apps that read <style> (Gmail and Apple Mail
// on iOS/Android read the max-width query; Apple Mail and Outlook.com the dark one).
const CSS = `
:root { color-scheme: light dark; supported-color-schemes: light dark; }
@media only screen and (max-width: 480px) {
  .ssr-outer { padding: 0 !important; }
  .ssr-pad { padding-left: 16px !important; padding-right: 16px !important; }
  .ssr-h1 { font-size: 21px !important; }
  .ssr-fl, .ssr-fv { display: block !important; width: auto !important; white-space: normal !important; }
  .ssr-fl { padding: 9px 0 0 !important; font-size: 12px !important; }
  .ssr-fv { padding: 1px 0 0 !important; }
  .ssr-desk { display: none !important; }
  .ssr-phone { display: inline !important; }
  .ssr-col { width: 52px !important; }
}
@media (prefers-color-scheme: dark) {
  .ssr-page { background: #0f141a !important; }
  .ssr-ink { color: #e8edf2 !important; }
  .ssr-ink2 { color: #b9c4cf !important; }
  .ssr-muted { color: #8f9aa6 !important; }
  .ssr-rule { border-color: #2a3440 !important; }
  .ssr-accent { color: #8fc8ff !important; }
  .ssr-bar { background: #5b6b7d !important; }
}`;

// The page: preview line, the two-line header, the body, the footer (where the brand lives).
function shell({ title, preheader, header, dateLabel, body, footer }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escape(title)}</title>
<style>${CSS}</style>
</head>
<body class="ssr-page" style="margin:0;padding:0;background:#ffffff;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#ffffff;">${escape(preheader)}&#8203;&#8199;&#8203;&#8199;&#8203;&#8199;&#8203;&#8199;</div>
<table role="presentation" class="ssr-page" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">
  <tr><td align="center" class="ssr-outer" style="padding:8px 10px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
      <tr><td class="ssr-pad" style="padding:22px 24px 4px;">
        <div class="ssr-h1 ssr-ink" style="font:800 24px/1.3 ${FONT};color:${INK};">${header}</div>
        ${dateLabel ? `<div class="ssr-muted" style="margin-top:4px;font:14px/1.4 ${FONT};color:${MUTED};">${escape(dateLabel)}</div>` : ''}
      </td></tr>
      <tr><td class="ssr-pad" style="padding:18px 24px 8px;">${body}</td></tr>
      <tr><td class="ssr-pad ssr-muted" style="padding:16px 24px 28px;font:13px/1.6 ${FONT};color:${MUTED};">${footer}</td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// The one verdict badge per email, inside the header line
const badge = (v) => `<span style="display:inline-block;padding:1px 8px 2px;border-radius:6px;background:${v.color};color:#ffffff;font:800 0.72em/1.4 ${FONT};letter-spacing:.04em;vertical-align:0.12em;white-space:nowrap;">${escape(v.label)}</span>`;

function button(href, label, color) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:8px;background:${color};">
    <a href="${escape(href)}" style="display:inline-block;padding:11px 18px;font:600 15px/1.2 ${FONT};color:#ffffff;text-decoration:none;border-radius:8px;">${escape(label)}</a>
  </td></tr></table>`;
}
const textLink = (href, label, color) => `<a href="${escape(href)}" class="ssr-accent" style="font:600 15px/1.4 ${FONT};color:${color};text-decoration:none;">${escape(label)}</a>`;

// The glance: every place in ranked order, name + headline number + best window. One
// rule above and below groups it; no heading, no badges, no inner dividers.
function glanceBox(kind, rows) {
  let lastGroup = null;
  const out = rows.map((r) => {
    const group = r.group && r.group !== lastGroup ? `<div class="ssr-muted" style="margin:10px 0 2px;font:13px/1.4 ${FONT};color:${MUTED};">${escape(r.group)}</div>` : '';
    lastGroup = r.group ?? lastGroup;
    return `${group}<div style="padding:5px 0;">
      <div class="ssr-ink" style="font:700 16px/1.35 ${FONT};color:${INK};">${escape(r.name)} <span class="ssr-accent" style="font-weight:600;color:${ACCENT[kind]};white-space:nowrap;">${escape(r.headline)}</span></div>
      ${r.when ? `<div class="ssr-ink2" style="font:14px/1.4 ${FONT};color:${INK_2};">${escape(r.when)}</div>` : ''}
    </div>`;
  }).join('');
  return `<div class="ssr-rule" style="border-top:1px solid ${RULE};border-bottom:1px solid ${RULE};padding:8px 0 10px;margin-bottom:22px;">${out}</div>`;
}

// The days ahead as bars sized to the value. Days past the 5th are desktop-only
// (`ssr-desk`), so a phone shows 5 columns with room to breathe.
function barStrip(cells, color, link) {
  if (!cells.length) return '';
  // On a phone, the days past the 5th are behind this link
  const more = cells.length > 5 && link
    ? `<div><a href="${escape(link)}" class="ssr-phone ssr-accent" style="display:none;font:600 13px/1.4 ${FONT};color:${color};text-decoration:none;">See the full week (${escape(cells.slice(5).map((x) => `${x.top} ${x.label}`).join(', '))}) →</a></div>`
    : '';
  const max = Math.max(...cells.map((x) => x.value || 0), 0.1);
  const H = 40;
  const cls = (i) => (i >= 5 ? ' ssr-desk' : '');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">
    <tr>${cells.map((x, i) => `<td class="ssr-col${cls(i)}" style="vertical-align:bottom;text-align:center;padding:0 6px 0 0;width:46px;">
      <div class="${x.on ? 'ssr-accent' : 'ssr-ink2'}" style="font:700 12px/1.2 ${FONT};color:${x.on ? color : INK_2};margin-bottom:3px;white-space:nowrap;">${escape(x.label)}</div>
      <div style="height:${Math.round(H - Math.max(2, (x.value || 0) / max * H))}px;line-height:0;font-size:0;">&nbsp;</div>
      <div class="${x.on ? '' : 'ssr-bar'}" style="height:${Math.max(2, Math.round((x.value || 0) / max * H))}px;line-height:0;font-size:0;border-radius:3px 3px 0 0;background:${x.on ? color : '#c5ced8'};">&nbsp;</div>
    </td>`).join('')}</tr>
    <tr>${cells.map((x, i) => `<td class="ssr-muted${cls(i)}" style="padding:4px 6px 0 0;text-align:center;font:12px/1.2 ${FONT};color:${MUTED};">${escape(x.top)}</td>`).join('')}</tr>
  </table>${more}`;
}

// Facts: label beside value on desktop, label above value on a phone. No dividers.
// A value may be an array of { text, desk } parts: the full list shows on desktop (and
// in apps that ignore <style>); a phone shows only the parts without `desk`.
function factList(facts) {
  if (!facts.length) return '';
  const val = (v) => {
    if (!Array.isArray(v)) return escape(v);
    const all = v.map((p) => escape(p.text)).join(' · ');
    const phone = v.filter((p) => !p.desk).map((p) => escape(p.text)).join(' · ');
    return phone === all ? all : `<span class="ssr-desk">${all}</span><span class="ssr-phone" style="display:none;">${phone}</span>`;
  };
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">
    ${facts.map(([key, label, value]) => `<tr>
      <td class="ssr-fl ssr-muted" style="padding:5px 12px 5px 0;font:14px/1.45 ${FONT};color:${MUTED};white-space:nowrap;vertical-align:top;width:1%;">${iconLabel(key, label)}</td>
      <td class="ssr-fv ssr-ink" style="padding:5px 0;font:15px/1.45 ${FONT};color:${INK};vertical-align:top;">${val(value)}</td>
    </tr>`).join('')}
  </table>`;
}
const factText = (value) => (Array.isArray(value) ? value.map((p) => p.text).join(' · ') : value);

// One card. The top pick is full weight; the rest are lighter (thin rule, smaller name,
// a text link instead of a button) and only show what differs from the top pick.
function placeCard({ kind, item, link, verdict, strip, facts, cta, top }) {
  const score = item.rating?.score;
  const why = ratingWhy(item.rating);
  return `<div class="ssr-rule" style="border-top:${top ? 2 : 1}px solid ${top ? INK : RULE};padding:14px 0 6px;margin-bottom:22px;">
    <a href="${escape(link)}" class="ssr-ink" style="display:block;font:800 ${top ? 20 : 17}px/1.3 ${FONT};color:${top ? INK : INK_2};text-decoration:none;">${escape(item.name)}</a>
    <div class="ssr-muted" style="margin-top:2px;font:14px/1.5 ${FONT};color:${MUTED};">${escape(place(item))}${score != null ? ` · <span style="color:#b98300;letter-spacing:1px;">${stars(score)}</span> ${score}/5 today` : ''}</div>
    ${why ? `<div class="ssr-ink2" style="margin-top:2px;font:14px/1.45 ${FONT};color:${INK_2};">${escape(cap(why))}</div>` : ''}
    <div class="ssr-ink" style="margin-top:10px;font:${top ? '700 16px' : '600 15px'}/1.45 ${FONT};color:${top ? INK : INK_2};">${verdict}</div>
    ${strip}
    ${factList(facts)}
    <div style="margin-top:14px;">${top ? button(link, cta, ACCENT[kind]) : textLink(link, cta, ACCENT[kind])}</div>
  </div>`;
}

// What this email is and how to change it. The brand lives here, not at the top. (No
// "Unsubscribe" link: a link with that name has to work in one tap, and a static site
// can't do that yet. Manage alerts is where you turn them off.)
function footerHtml(manage, what) {
  return `<div class="ssr-rule" style="border-top:1px solid ${RULE};padding-top:14px;">
    <b class="ssr-ink2" style="color:${INK_2};">${BRAND}</b> · ${escape(what)} It isn’t a marketing email.<br>
    <a href="${escape(manage)}" style="color:${INK_2};text-decoration:underline;">Manage alerts</a> (turn them off, or change places and thresholds)<br>
    Conditions are forecasts, not guarantees. Check before you go.
  </div>`;
}
const footerText = (manage, what) => `${BRAND} · ${what} It isn't a marketing email.\nManage alerts (turn them off, or change places and thresholds): ${manage}\nConditions are forecasts, not guarantees. Check before you go.`;

// Facts the top card already shows are dropped from the cards after it, so the same
// sentence (same tides, same period, same wetsuit) is never printed more than once.
function dedupeAgainstTop(cards) {
  if (cards.length < 2) return cards;
  const seen = new Set(cards[0].facts.map(([, label, value]) => `${label}|${factText(value)}`));
  return cards.map((c, i) => (i === 0 ? c : { ...c, facts: c.facts.filter(([, label, value]) => !seen.has(`${label}|${factText(value)}`)) }));
}

// The header line: "🏄 El Porto is [GO] 5/5 — cleanest 5am–noon", or, when nothing
// rates above 2, "❄️ [SKIP] Nothing worth going for — best is Crystal Mountain, 1/5".
function headerLine(kind, top, v, score, tail) {
  const name = top.item.name;
  if (v.key === 'closed') return { html: `${ICON[kind]} ${badge(v)} Nothing rideable yet — ${escape(name)}: ${escape(seasonText(top.item))}`, text: `Nothing rideable yet (${v.label}) — ${name}: ${seasonText(top.item)}` };
  if (v.key === 'skip') return { html: `${ICON[kind]} ${badge(v)} Nothing worth going for — best is ${escape(name)}, ${score}/5`, text: `${v.label}: nothing worth going for — best is ${name}, ${score}/5` };
  return { html: `${ICON[kind]} ${escape(name)} is ${badge(v)} ${score}/5${tail ? ` — ${escape(tail)}` : ''}`, text: `${name} is ${v.label} · ${score}/5${tail ? ` — ${tail}` : ''}` };
}

// ---------- Snow alert ----------

export function snowEmail({ user, alerts, items, siteUrl, dateLabel, lookAhead }) {
  const color = ACCENT.snow;
  const byPlace = new Map();
  for (const a of alerts) {
    const entry = byPlace.get(a.itemId) ?? { item: items.get(a.itemId), coming: null, fresh: null };
    if (a.id.startsWith('fresh:')) entry.fresh = a;
    else entry.coming = a;
    byPlace.set(a.itemId, entry);
  }
  const amountOf = (a) => Number(a?.title.match(/([\d.]+)"/)?.[1] ?? 0);
  const amount = (p) => Math.max(amountOf(p.coming), amountOf(p.fresh));
  const places = rankAndGroup([...byPlace.values()].filter((p) => p.item), user.rider,
    (a, b) => (b.item.rating?.score ?? 0) - (a.item.rating?.score ?? 0) || amount(b) - amount(a), (p) => !rideable(p.item));
  for (const p of places) {
    const firstDate = ok(p.item.forecast) ? p.item.forecast.data.days[0]?.date : null;
    p.best = snowBest(p, firstDate);
    p.v = verdictOf(p.item.rating?.score, !rideable(p.item));
    const snowy = (p.coming?.days ?? []).filter((d) => d.inches > 0);
    p.headline = p.coming ? `${amountOf(p.coming)}" by ${dayShort(snowy.at(-1)?.date ?? p.coming.days.at(-1).date)}` : `${amountOf(p.fresh)}" fresh in 48h`;
    p.notYet = !rideable(p.item) ? (isClosed(p.item) ? seasonText(p.item) : `0" base (${seasonText(p.item).toLowerCase()})`) : '';
  }
  const top = places[0];
  const score = (p) => p.item.rating?.score;
  const best = Math.max(...places.map((p) => score(p) ?? 0));
  const quiet = top.v.key === 'skip' || top.v.key === 'closed';
  const subject = quiet
    ? `Snow alert: nothing above ${best}/5 ${lookText(lookAhead)} · best is ${top.item.name}`
    : `Snow alert: ${top.item.name}${places.length > 1 ? ` + ${places.length - 1} more` : ''}, ${top.headline} (rated ${score(top)}/5)`;
  const head = headerLine('snow', top, top.v, score(top), top.best.text);

  const cardData = places.map((p, i) => {
    const r = p.item;
    const obs = ok(r.observed) ? r.observed.data : null;
    const forecast = ok(r.forecast) ? r.forecast.data.days : [];
    const ride = forecast.find((d) => d.date === p.best.rideDate) ?? forecast[0];
    const rideLabel = ride ? (ride.date === forecast[0]?.date ? 'Today' : dayShort(ride.date)) : '';
    const days = forecast.slice(0, lookAhead);
    const maxSnow = Math.max(...days.map((x) => x.snowfall ?? 0));
    const verdict = isClosed(r)
      ? `Not rideable yet. ${seasonText(r)}; this snow builds the base for opening day.`
      : `Best day: ${p.best.text}${ride?.feelsLow != null ? `, feels like ${ride.feelsLow}°` : ''}${p.notYet ? ' — not rideable yet (0" base)' : obs?.depthNow != null ? `, base ${obs.depthNow}"` : ''}`;
    return {
      p, i, link: `${siteUrl}#snow/${r.id}`, verdict,
      strip: barStrip(days.map((d) => ({ top: d.date === forecast[0]?.date ? 'Today' : dayShort(d.date), value: d.snowfall ?? 0, label: `${d.snowfall ?? 0}"`, on: (d.snowfall ?? 0) > 0 && d.snowfall === maxSnow })), color, `${siteUrl}#snow/${r.id}`),
      facts: [
        ['season', 'Season', seasonText(r)],
        obs ? ['fresh', 'Fresh snow', `${obs.newSnow.h24}" in 24h · ${obs.newSnow.h48}" in 48h`] : null,
        obs?.depthNow != null ? ['base', 'Base', `${obs.depthNow}"${r.observed.modelled ? ' (modelled)' : ''}`] : null,
        ride ? ['temp', `${rideLabel} temp`, `${ride.tempHigh}° / ${ride.tempLow}°F${ride.feelsLow != null ? `, feels like ${ride.feelsLow}°` : ''}`] : null,
        ride?.windMax != null ? ['wind', `${rideLabel} wind`, `${ride.windDeg != null ? `${compass(ride.windDeg)} ` : ''}${ride.windMax} mph${ride.gustMax != null ? `, gusts ${ride.gustMax}` : ''}`] : null,
        r.passes?.length ? ['pass', 'Pass', passText(r)] : null,
      ].filter(Boolean),
      // Never an invitation to go when it can't be ridden
      cta: p.notYet ? `${r.name} forecast →` : `See ${rideLabel === 'Today' ? 'today' : dayLong(ride?.date ?? forecast[0].date)} at ${r.name} →`,
    };
  });
  // Season stays on every card, even when it's the same as the top card's
  const deduped = dedupeAgainstTop(cardData).map((c, i) => (i === 0 || c.facts.some(([k]) => k === 'season') ? c : { ...c, facts: [cardData[i].facts[0], ...c.facts] }));
  const cards = deduped.map((c) => placeCard({ kind: 'snow', item: c.p.item, link: c.link, verdict: escape(c.verdict), strip: c.strip, facts: c.facts, cta: c.cta, top: c.i === 0 })).join('');

  const glanceWhen = (p) => (p.notYet ? `Not rideable yet: ${p.notYet}` : `Best ${p.best.text}`);
  const what = `Your daily snow alert: you turned on snow alerts, looking ${lookAhead} days ahead, and these mountains matched.`;
  const others = places.slice(1).map((p) => p.item.name);
  const html = shell({
    title: subject,
    // The inbox preview adds what the header doesn't: who else, and the base
    preheader: [others.length ? `Also: ${others.join(', ')}` : null, baseOf(top.item) != null ? `${top.item.name} base ${baseOf(top.item)}"` : null].filter(Boolean).join('. '),
    header: head.html,
    dateLabel,
    body: glanceBox('snow', places.map((p) => ({ group: p.group, name: p.item.name, headline: p.headline, when: glanceWhen(p) }))) + cards,
    footer: footerHtml(`${siteUrl}#alerts`, what),
  });
  const text = [
    head.text,
    dateLabel,
    '',
    ...glanceText(places.map((p) => ({ group: p.group, name: p.item.name, headline: p.headline, when: glanceWhen(p) }))),
    '',
    ...deduped.map((c) => cardText(c.p.item, c.verdict, c.facts, c.link,
      `Snow by day: ${(ok(c.p.item.forecast) ? c.p.item.forecast.data.days : []).slice(0, lookAhead).map((d) => `${dayShort(d.date)} ${d.snowfall ?? 0}"`).join(', ')}`)),
    footerText(`${siteUrl}#alerts`, what),
  ].join('\n');
  return { subject, text, html };
}

// Plain-text glance and cards, mirroring the HTML
function glanceText(rows) {
  let last = null;
  return rows.flatMap((r) => {
    const out = [];
    if (r.group && r.group !== last) { out.push(r.group); last = r.group; }
    out.push(`- ${r.name}: ${r.headline}${r.when ? `. ${r.when}` : ''}`);
    return out;
  });
}
function cardText(item, verdict, facts, link, strip) {
  const s = item.rating?.score;
  const why = ratingWhy(item.rating);
  return [
    `${item.name} (${place(item)})${s != null ? ` · ${s}/5 today` : ''}`,
    why ? `  ${cap(why)}` : null,
    `  ${verdict}`,
    strip ? `  ${strip}` : null,
    ...facts.map(([, label, value]) => `  ${label}: ${factText(value)}`),
    `  ${link}`,
    '',
  ].filter((x) => x !== null).join('\n');
}

// ---------- Surf alert ----------

export function surfEmail({ user, alerts, items, siteUrl, dateLabel, lookAhead, tides = {}, skills }) {
  const color = ACCENT.surf;
  const profile = user.profile ?? { levels: [], boards: [] };
  const list = alerts.map((a) => ({ a, item: items.get(a.itemId) })).filter((x) => x.item);
  const ftOf = (x) => x.a.days[0].ft;
  const spots = rankAndGroup(list, user.rider, (a, b) => (b.item.rating?.score ?? 0) - (a.item.rating?.score ?? 0) || ftOf(b) - ftOf(a));
  for (const x of spots) {
    const d0 = x.a.days[0];
    const waveDays = ok(x.item.waves) ? x.item.waves.data.days ?? [] : [];
    const windDays = ok(x.item.wind) ? x.item.wind.data.days ?? [] : [];
    x.waveDay = waveDays.find((d) => d.date === d0.date) ?? { ft: d0.ft, s: d0.s };
    x.windDay = windDays.find((d) => d.date === d0.date) ?? null;
    x.when = d0.when;
    x.day = x.when === 'today' ? 'today' : dayLong(d0.date);
    x.v = verdictOf(x.item.rating?.score);
    x.headline = `${d0.ft} ft @ ${Math.round(d0.s)} s ${d0.when}`;
    const w = x.windDay?.window;
    const sw = mainSwell(x.waveDay);
    const swellBit = sw ? `, ${compass(sw[2])} ${swellKind(sw[1])}` : '';
    x.windowShort = w?.from != null ? `cleanest ${hourRange(w.from, w.to)}${x.when === 'today' ? '' : ` ${dayShort(d0.date)}`}` : windowText(w);
    x.windowLine = `${cap(x.day)}: ${windowText(w) || `${d0.wind?.relative ?? ''} wind`}`;
    if (w?.from != null) {
      const windBit = x.windDay?.relative === 'offshore' ? 'offshore' : 'light wind';
      x.verdict = `Best window: ${x.day} ${hourRange(w.from, w.to)}, ${windBit}${swellBit}.${w.badFrom != null ? ` ${cap(w.badRel ?? 'windy')} after ${hourText(w.badFrom)}.` : ''}`;
    } else {
      x.verdict = `Best bet: ${x.day}${swellBit}. ${cap(windowText(w) || 'check the wind before you go')}.`;
    }
  }
  const top = spots[0];
  const score = (s) => s.item.rating?.score;
  const best = Math.max(...spots.map((s) => score(s) ?? 0));
  const quiet = top.v.key === 'skip';
  const subject = quiet
    ? `Surf alert: nothing above ${best}/5 ${lookText(lookAhead)} · best is ${top.item.name}`
    : `Surf alert: ${top.item.name}${spots.length > 1 ? ` + ${spots.length - 1} more` : ''}, ${top.headline} (rated ${score(top)}/5)`;
  const head = headerLine('surf', top, top.v, score(top), top.windowShort);

  const factsOf = (x) => {
    const d0 = x.a.days[0];
    const label = x.when === 'today' ? 'Today' : dayShort(d0.date);
    const buoy = buoyLine(x.item);
    const buoyWater = buoy && ok(x.item.buoy) ? x.item.buoy.data.waterTempF : null;
    const water = buoyWater ?? (ok(x.item.waves) ? x.item.waves.data.seaSurfaceTempF : null);
    const wind = x.windDay;
    const main = mainSwell(x.waveDay);
    const tideList = tidesOn(tides[x.item.tideStation], d0.date);
    // On a phone: the next two tides only (all of them on a wider screen and in the text version)
    let shown = 0;
    const firstNext = tideList.findIndex((t) => t.next || x.when !== 'today');
    const tideParts = tideList.map((t, i) => {
      const keep = i >= Math.max(0, firstNext) && shown < 2;
      if (keep) shown++;
      return { text: t.text, desk: !keep };
    });
    return [
      ['waves', `${label} waves`, swellLine(x.waveDay)],
      main ? ['period', 'Period', `${Math.round(main[1])} s — ${periodMeaning(main[1])}`] : null,
      wind ? ['wind', `${label} ${hourText(Number(x.item.wind.data.forTime?.slice(11, 13) ?? 7))}`, `${compass(wind.deg)} ${wind.mph} mph${wind.gust != null ? `, gusts ${wind.gust}` : ''} (${wind.relative})`] : null,
      tideParts.length ? ['tide', `${label} tides`, tideParts] : null,
      x.when === 'today' && buoy ? ['buoy', 'Buoy now', buoy] : null,
      water != null ? ['water', 'Wetsuit', `${Math.round(water)}°F — ${wetsuit(water)}`] : null,
      wind?.airHigh != null ? ['temp', `${label} air`, `High ${wind.airHigh}°F`] : null,
      boardLine(x.waveDay, profile, skills) ? ['board', 'Board', boardLine(x.waveDay, profile, skills)] : null,
    ].filter(Boolean);
  };

  const cardData = dedupeAgainstTop(spots.map((x, i) => {
    const goodDates = new Set(x.a.days.map((d) => d.date));
    const allDays = (ok(x.item.waves) ? x.item.waves.data.days ?? [] : []).slice(0, lookAhead);
    const first = allDays[0]?.date;
    return {
      x, i, link: `${siteUrl}#surf/${x.item.id}`, facts: factsOf(x),
      strip: barStrip(allDays.map((d) => ({ top: d.date === first ? 'Today' : dayShort(d.date), value: d.ft ?? 0, label: `${d.ft} ft`, on: goodDates.has(d.date) })), color),
      cta: `See ${x.when === 'today' ? "today's window" : dayLong(x.a.days[0].date)} at ${x.item.name} →`,
    };
  }));
  const cards = cardData.map((c) => placeCard({ kind: 'surf', item: c.x.item, link: c.link, verdict: escape(c.x.verdict), strip: c.strip, facts: c.facts, cta: c.cta, top: c.i === 0 })).join('');

  const what = `Your daily surf alert: you turned on surf alerts, looking ${lookAhead} days ahead, and these beaches matched. Blue bars are days that fit you.`;
  const others = spots.slice(1).map((s) => s.item.name);
  const water = ok(top.item.waves) ? top.item.waves.data.seaSurfaceTempF : null;
  const html = shell({
    title: subject,
    preheader: [others.length ? `Also: ${others.join(', ')}` : null, water != null ? `${Math.round(water)}°F water, ${wetsuit(water)}` : null].filter(Boolean).join('. '),
    header: head.html,
    dateLabel,
    body: glanceBox('surf', spots.map((x) => ({ group: x.group, name: x.item.name, headline: x.headline, when: x.windowLine }))) + cards,
    footer: footerHtml(`${siteUrl}#alerts`, what),
  });
  const text = [
    head.text,
    dateLabel,
    '',
    ...glanceText(spots.map((x) => ({ group: x.group, name: x.item.name, headline: x.headline, when: x.windowLine }))),
    '',
    ...cardData.map((c) => cardText(c.x.item, c.x.verdict, c.facts, c.link,
      `Waves by day: ${(ok(c.x.item.waves) ? c.x.item.waves.data.days : []).slice(0, lookAhead).map((d) => `${dayShort(d.date)} ${d.ft} ft`).join(', ')}`)),
    footerText(`${siteUrl}#alerts`, what),
  ].join('\n');
  return { subject, text, html };
}

// ---------- Flat week: the weekly heartbeat ----------
// watched: { snow: [{ item }], surf: [{ item }] } from watching() in alert-rules.js

export function digestEmail({ user, watched, siteUrl, dateLabel, firstOne = false, surfDays = 3 }) {
  const SHOW = 3;
  // The best of the next 7 days at each place: the snowiest day, or the biggest waves
  const snow = watched.snow.map(({ item }) => {
    const days = ok(item.forecast) ? item.forecast.data.days.slice(0, 7) : [];
    const best = days.reduce((m, d) => ((d.snowfall ?? 0) > (m?.snowfall ?? 0) ? d : m), null);
    return { name: item.name, link: `${siteUrl}#snow/${item.id}`, closed: !rideable(item), value: best?.snowfall ?? 0,
      line: !rideable(item) ? `Not rideable yet: ${seasonText(item).toLowerCase()}` : best ? `Most snow: ${best.snowfall}" ${dayLong(best.date)}` : 'No snow in the 7-day forecast' };
  }).sort((a, b) => Number(a.closed) - Number(b.closed) || b.value - a.value);
  // Beaches: the biggest day in the next 7 that FITS you (best = from fitDays, done by
  // the caller). If it's past your alert window, say so: that's why it didn't alert.
  // No fitting day: say that, with the biggest day only as context.
  const surf = watched.surf.map(({ item, best: fit }) => {
    const days = ok(item.waves) ? item.waves.data.days.slice(0, 7) : [];
    const link = `${siteUrl}#surf/${item.id}`;
    if (fit) {
      const idx = days.findIndex((d) => d.date === fit.date);
      const past = idx >= surfDays ? ` (past your ${surfDays}-day alert window)` : '';
      return { name: item.name, link, value: 100 + fit.ft, line: `Fits you ${dayLong(fit.date)}: ${fit.ft} ft @ ${Math.round(fit.s)} s${past}` };
    }
    const big = days.reduce((m, d) => (d.ft > (m?.ft ?? -1) ? d : m), null);
    return { name: item.name, link, value: 0, line: big ? `Nothing that fits you in the next 7 days (biggest: ${big.ft} ft ${dayLong(big.date)})` : 'No wave forecast right now' };
  }).sort((a, b) => b.value - a.value);
  const total = snow.length + surf.length;
  const lead = snow.find((x) => x.value > 0 && !x.closed) ?? surf[0];
  const subject = firstOne
    ? `You're set up: watching ${plural(total, 'place')}`
    : `Nothing hit your thresholds this week${lead ? ` · best ahead: ${lead.name}` : ''}`;
  const name = firstName(user);
  const section = (rows) => rows.slice(0, SHOW).map((r) => `<div style="padding:5px 0;">
      <a href="${escape(r.link)}" class="ssr-ink" style="font:700 16px/1.35 ${FONT};color:${INK};text-decoration:none;">${escape(r.name)}</a>
      <div class="ssr-ink2" style="font:14px/1.4 ${FONT};color:${INK_2};">${escape(r.line)}</div>
    </div>`).join('');
  // One line on why a big week ahead didn't send an alert, so it doesn't read as a contradiction
  const why = `Alerts go out when a day reaches your snow amount, or when waves fit your level and board within ${surfDays} days. None did, so here's the best of the 7 days ahead.`;
  const what = firstOne
    ? 'Alerts only arrive on mornings something matches your thresholds; if nothing does for a week, you get a short note like this instead.'
    : 'The weekly note: nothing matched your alert thresholds in the past week.';
  const html = shell({
    title: subject,
    preheader: firstOne ? `${name ? `${name}, y` : 'Y'}our alerts are working.` : (lead ? `Best ahead: ${lead.name}. ${lead.line}.` : 'A quiet week ahead too.'),
    header: firstOne ? `${ICON.ok} You're set up: watching ${plural(total, 'place')}` : `${ICON.quiet} Quiet week: nothing hit your thresholds`,
    dateLabel,
    body: `<p class="ssr-ink2" style="margin:0 0 12px;font:15px/1.5 ${FONT};color:${INK_2};">${firstOne ? 'Your alerts are working. When something matches, it lands here in the morning.' : escape(why)}</p>
      <div class="ssr-rule" style="border-top:1px solid ${RULE};border-bottom:1px solid ${RULE};padding:8px 0 10px;margin-bottom:16px;">
        ${snow.length ? `<div class="ssr-muted" style="margin:6px 0 2px;font:13px/1.4 ${FONT};color:${MUTED};">${iconLabel('snow', 'Mountains')}</div>${section(snow)}` : ''}
        ${surf.length ? `<div class="ssr-muted" style="margin:12px 0 2px;font:13px/1.4 ${FONT};color:${MUTED};">${iconLabel('surf', 'Beaches')}</div>${section(surf)}` : ''}
      </div>
      ${total > SHOW * 2 || snow.length > SHOW || surf.length > SHOW ? textLink(`${siteUrl}#alerts`, `See all ${plural(total, 'place')} →`, ACCENT.plain) : textLink(`${siteUrl}#alerts`, 'Manage alerts →', ACCENT.plain)}`,
    footer: footerHtml(`${siteUrl}#alerts`, what),
  });
  const text = [
    firstOne ? `You're set up: watching ${plural(total, 'place')}` : 'Quiet week: nothing hit your thresholds',
    dateLabel,
    '',
    firstOne ? 'Your alerts are working. When something matches, it lands here in the morning.' : why,
    ...(snow.length ? ['', 'Mountains', ...snow.slice(0, SHOW).map((r) => `- ${r.name}: ${r.line}`)] : []),
    ...(surf.length ? ['', 'Beaches', ...surf.slice(0, SHOW).map((r) => `- ${r.name}: ${r.line}`)] : []),
    '',
    `See all ${plural(total, 'place')}: ${siteUrl}#alerts`,
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
    title: subject,
    preheader: 'One tap to start getting alerts at this address.',
    header: 'Get your Snow &amp; Surf alerts here?',
    body: `<p class="ssr-ink" style="margin:0 0 6px;font:15px/1.5 ${FONT};color:${INK};">${name ? `Hi ${escape(name)},` : 'Hi,'}</p>
      <p class="ssr-ink2" style="margin:0 0 14px;font:15px/1.5 ${FONT};color:${INK_2};">Tap the button to send your ${BRAND} alerts to this address.</p>
      ${button(link, 'Confirm my email', ACCENT.plain)}
      <p class="ssr-muted" style="margin:16px 0 0;font:13px/1.6 ${FONT};color:${MUTED};">Or copy this link into your browser:<br><span style="word-break:break-all;">${escape(link)}</span></p>`,
    footer: `<div class="ssr-rule" style="border-top:1px solid ${RULE};padding-top:14px;">If you didn't ask for this, ignore this email and nothing will be sent here.<br><b>${BRAND}</b></div>`,
  });
  const text = `${name ? `Hi ${name},` : 'Hi,'}\n\nTap this link to get ${BRAND} alerts at this address:\n\n${link}\n\nIf you didn't ask for this, ignore this email and nothing will be sent here.`;
  return { subject, text, html };
}
