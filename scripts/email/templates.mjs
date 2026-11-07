// The emails people get: a snow alert, a surf alert, a weekly digest (when nothing hit
// your thresholds), and the "confirm your address" email. Each is { subject, text, html }.
//
// Layout, top to bottom:
//   1. One header card: kicker (SURF ALERT · DATE), the verdict line, a sub-line.
//   2. TOP PICK: the best-ranked place as a full card (headline number, cam link,
//      verdict, day bars, facts, one specific button).
//   3. Shared today: conditions that are the same at several places (same tide
//      station, same buoy, same water), in one dashed box, stated once.
//   4. ALSO ON YOUR LIST: every other place as a lighter card (headline number and a
//      one-line verdict; the full facts are one tap away on the site).
//
// Email apps are pickier than browsers: layout uses tables and inline styles, plus a
// small <style> block for the phone layout (max-width 480px; Gmail and Apple Mail on
// iOS/Android read it) and dark mode. Every emoji sits next to a text label. Live cams
// are links only (video doesn't play in email, and a still frame is stale on arrival).
// No images, no tracking pixels.
import { withinReach, normalizeRider } from '../../js/recommend.js';
// The verdict words (GO / WORTH A LOOK / SKIP / NOT OPEN YET), shared with the website
import { VERDICT, verdictOf, notRideable } from '../../js/verdict.js';

export { VERDICT, verdictOf };

const BRAND = 'Snow & Surf Report';
// Deep ocean navy as the one accent (a light sky blue washes out on white)
const ACCENT = '#0d4a6e';
const BAR_2 = '#9dbfd4'; // the other days' bars, so the best day stands out
const SHARED_BG = '#dbe9f2';
const PAGE_BG = '#eef3f7';
const CARD_BORDER = '#d5dee6';
const MUTED_BG = '#f5f8fa';
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const INK = '#16202b';
const INK_2 = '#4b5866';
const MUTED = '#66727f';
// One emoji per kind of fact, always next to its text label, never on its own
const ICON = {
  surf: '🏄', board: '🏄', snow: '❄️', fresh: '❄️', window: '🕔', waves: '🌊', wind: '💨', tide: '🌙',
  wetsuit: '🩳', air: '🌡️', day: '📅', base: '🏔️', mountains: '🏔️', feels: '🥶', pass: '🎫', cam: '📷',
  shared: '🤝', alerts: '🔔', closed: '🚫', digest: '📬',
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
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const ok = (b) => b?.status === 'ok';
const emoji = (key) => (key && ICON[key] ? `<span aria-hidden="true">${ICON[key]}</span>&nbsp;` : '');
const emojiText = (key) => (key && ICON[key] ? `${ICON[key]} ` : '');
const lookText = (n) => (n >= 7 ? 'this week' : `in the next ${n} days`);
// Same input, same order: the last tie-breaker is always the name
const byName = (a, b) => a.item.name.localeCompare(b.item.name);

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compass = (deg) => (deg == null ? '' : COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]);
const hourText = (h) => (h === 12 ? 'noon' : h === 0 || h === 24 ? 'midnight' : h < 12 ? `${h}am` : `${h - 12}pm`);
const hourRange = (a, b) => {
  if (b === 12) return `${hourText(a)}–noon`;
  const sameHalf = (a < 12) === (b < 12) && a !== 12;
  return sameHalf ? `${a > 12 ? a - 12 : a}–${hourText(b)}` : `${hourText(a)}–${hourText(b)}`;
};

// Why the rating is what it is. A 1-3 always explains itself; a 4-5 only says what held it back.
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

export function windowText(win) {
  if (!win) return '';
  const turn = win.badFrom != null ? `${win.badRel ?? 'windy'} after ${hourText(win.badFrom)}` : '';
  if (win.from != null) return [`cleanest ${hourRange(win.from, win.to)}`, turn].filter(Boolean).join(', ');
  return win.badFrom != null ? `wind-affected from ${hourText(win.badFrom)}` : 'breezy but workable all day';
}

// One day's tides, in order, with heights. On today's card, the next two still to come;
// on another day, that day's first two. Built once: there is no second, longer copy
// anywhere in the email. "(full 4 tides on the site)" says where the rest are.
export function tideLine(station, date, today) {
  if (!ok(station) || !station.data?.events?.length) return null;
  const tz = station.timezone || 'UTC';
  const localDate = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: tz });
  const at = (t) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
  const all = station.data.events
    .filter((e) => localDate(e.t) === date)
    .sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  if (!all.length) return null;
  const upcoming = today ? all.filter((e) => Date.parse(e.t) > Date.now()) : all;
  const shown = (upcoming.length ? upcoming : all).slice(0, 2);
  const text = shown.map((e) => `${e.type === 'H' ? 'High' : 'Low'} ${at(e.t)} (${e.ft.toFixed(1)} ft)`).join(' · ');
  return all.length > shown.length ? `${text} (full ${all.length} tides on the site)` : text;
}

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

// "Watch the El Porto cam →": only for spots with a cam checked to exist (camUrl in the
// report, from config/locations.json). Surfline cams can need an account, so they say so.
function camLink(item) {
  if (!item.camUrl) return null;
  const label = item.camLabel ?? (/surfline\.com/i.test(item.camUrl) ? `Surfline cam for ${item.name} (may need login) →` : `Watch the ${item.name} cam →`);
  return { url: item.camUrl, label };
}

// ---------- Snow facts ----------

const isClosed = (r) => r.season?.status === 'closed';
const rideable = (r) => !notRideable(r); // the same rule the website uses (js/verdict.js)
export function seasonText(r) {
  const s = r.season ?? {};
  if (s.status === 'open') return 'Open';
  if (s.status === 'closed' && s.opensOn && !(s.closesOn && s.closesOn < new Date().toISOString().slice(0, 10))) return `Opens ${monthDay(s.opensOn)}`;
  if (s.status === 'closed') return 'Closed for the season';
  return 'Opening date not set';
}
// What stops you going, if anything: "Not open yet — opening date not set"
function blocker(r) {
  if (r.season?.status === 'open') return null;
  const s = seasonText(r);
  return s === 'Closed for the season' ? 'Closed for the season' : `Not open yet — ${s.charAt(0).toLowerCase()}${s.slice(1)}`;
}
const passText = (r) => (r.passes ?? []).map((p) => `${p.pass}${p.access ? ` (${p.access.toLowerCase()})` : ''}`).join(' · ');

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

// Local first, then trip spots; best first in each; places you can't ride yet last.
// Never drops a place.
function rankAndGroup(list, rider, rank, notYet = () => false) {
  const r = normalizeRider(rider);
  const grouping = Boolean(r.home && r.radiusMi);
  const sorted = [...list].sort((a, b) => rank(a, b) || byName(a, b));
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
}
@media (prefers-color-scheme: dark) {
  .ssr-page { background: #0f141a !important; }
  .ssr-card { background: #161d25 !important; border-color: #2a3440 !important; }
  .ssr-muted-card { background: #131a21 !important; border-color: #26303b !important; }
  .ssr-shared { background: #15293a !important; border-color: #3a5a74 !important; }
  .ssr-ink { color: #e8edf2 !important; }
  .ssr-ink2 { color: #b9c4cf !important; }
  .ssr-muted { color: #8f9aa6 !important; }
  .ssr-accent { color: #8ec8e8 !important; }
  .ssr-accent-border { border-top-color: #8ec8e8 !important; }
  .ssr-bar-best { background: #8ec8e8 !important; }
  .ssr-bar { background: #4b6578 !important; }
  .ssr-btn { background: #8ec8e8 !important; }
  .ssr-btn a { color: #0b1620 !important; }
}`;

// The page: preview text, the header card, the body, the footer (where the brand lives).
function shell({ title, preheader, header, body, footer }) {
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
<body class="ssr-page" style="margin:0;padding:0;background:${PAGE_BG};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${PAGE_BG};">${escape(preheader)}&#8203;&#8199;&#8203;&#8199;&#8203;&#8199;&#8203;&#8199;</div>
<table role="presentation" class="ssr-page" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE_BG};">
  <tr><td align="center" class="ssr-outer" style="padding:16px 10px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
      <tr><td class="ssr-pad" style="padding:8px 24px 0;">${header}</td></tr>
      <tr><td class="ssr-pad" style="padding:18px 24px 4px;">${body}</td></tr>
      <tr><td class="ssr-pad ssr-muted" style="padding:14px 24px 28px;font:13px/1.6 ${FONT};color:${MUTED};">${footer}</td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// The header: one card, three lines (kicker, verdict, sub-line), nothing stacked above it
function headerCard({ kicker, verdict, sub }) {
  return `<div class="ssr-card ssr-accent-border" style="background:#ffffff;border-top:4px solid ${ACCENT};border-radius:12px;padding:16px 18px 16px;">
    <div class="ssr-accent" style="font:700 11px/1.4 ${FONT};color:${ACCENT};letter-spacing:.12em;text-transform:uppercase;">${kicker}</div>
    <div class="ssr-h1 ssr-ink" style="margin-top:6px;font:700 21px/1.3 ${FONT};color:${INK};">${verdict}</div>
    ${sub ? `<div class="ssr-muted" style="margin-top:6px;font:13px/1.45 ${FONT};color:${MUTED};">${escape(sub)}</div>` : ''}
  </div>`;
}

// "TOP PICK" / "ALSO ON YOUR LIST" / "MOUNTAINS"
const sectionLabel = (text, first = false) => `<div class="ssr-muted" style="margin:${first ? 2 : 18}px 0 8px;font:700 11px/1.4 ${FONT};color:${MUTED};letter-spacing:.12em;text-transform:uppercase;">${escape(text)}</div>`;

function button(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td class="ssr-btn" style="border-radius:8px;background:${ACCENT};">
    <a href="${escape(href)}" style="display:inline-block;padding:11px 18px;font:600 15px/1.2 ${FONT};color:#ffffff;text-decoration:none;border-radius:8px;">${escape(label)}</a>
  </td></tr></table>`;
}
const link = (href, label, size = 14) => `<a href="${escape(href)}" class="ssr-accent" style="font:600 ${size}px/1.5 ${FONT};color:${ACCENT};text-decoration:none;">${label}</a>`;

// The days ahead as bars sized to the value: the best day in navy, the rest steel blue.
// Days past the 5th hide on a phone (the link under the bars has the full week).
function barStrip(cells, caption) {
  if (!cells.length) return '';
  const max = Math.max(...cells.map((x) => x.value || 0), 0.1);
  const H = 40;
  const cls = (i) => (i >= 5 ? ' ssr-desk' : '');
  return `<div class="ssr-muted" style="margin-top:12px;font:12px/1.4 ${FONT};color:${MUTED};">${emoji('day')}${escape(caption)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:4px;">
    <tr>${cells.map((x, i) => `<td class="${cls(i).trim()}" style="vertical-align:bottom;text-align:center;padding:0 6px 0 0;width:46px;">
      <div class="${x.best ? 'ssr-accent' : 'ssr-ink2'}" style="font:700 12px/1.2 ${FONT};color:${x.best ? ACCENT : INK_2};margin-bottom:3px;white-space:nowrap;">${escape(x.label)}</div>
      <div style="height:${Math.round(H - Math.max(2, (x.value || 0) / max * H))}px;line-height:0;font-size:0;">&nbsp;</div>
      <div class="${x.best ? 'ssr-bar-best' : 'ssr-bar'}" style="height:${Math.max(2, Math.round((x.value || 0) / max * H))}px;line-height:0;font-size:0;border-radius:3px 3px 0 0;background:${x.best ? ACCENT : BAR_2};">&nbsp;</div>
    </td>`).join('')}</tr>
    <tr>${cells.map((x, i) => `<td class="ssr-muted${cls(i)}" style="padding:4px 6px 0 0;text-align:center;font:12px/1.2 ${FONT};color:${MUTED};">${escape(x.top)}</td>`).join('')}</tr>
  </table>`;
}

// Facts: emoji + label beside the value on desktop, label above value on a phone
function factList(facts) {
  if (!facts.length) return '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">
    ${facts.map(([key, label, value]) => `<tr>
      <td class="ssr-fl ssr-muted" style="padding:5px 12px 5px 0;font:14px/1.45 ${FONT};color:${MUTED};white-space:nowrap;vertical-align:top;width:1%;">${emoji(key)}${escape(label)}</td>
      <td class="ssr-fv ssr-ink" style="padding:5px 0;font:15px/1.45 ${FONT};color:${INK};vertical-align:top;">${escape(value)}</td>
    </tr>`).join('')}
  </table>`;
}

const ratingLine = (item, extra = '') => {
  const s = item.rating?.score;
  return `${escape(place(item))}${extra ? ` · ${escape(extra)}` : ''}${s != null ? ` · <span style="color:#b98300;letter-spacing:1px;">${stars(s)}</span> ${s}/5 today` : ''}`;
};

// The top pick: full weight (navy top border, shadow), everything you need to decide
function topCard({ item, group, headline, cam, verdict, strip, facts, cta, ctaHref }) {
  const why = ratingWhy(item.rating);
  return `<div class="ssr-card ssr-accent-border" style="background:#ffffff;border:1px solid ${CARD_BORDER};border-top:3px solid ${ACCENT};border-radius:12px;box-shadow:0 2px 10px rgba(13,74,110,.12);padding:16px 18px 18px;margin-bottom:14px;">
    <a href="${escape(ctaHref)}" class="ssr-ink" style="display:block;font:800 20px/1.3 ${FONT};color:${INK};text-decoration:none;">${escape(item.name)}</a>
    <div class="ssr-muted" style="margin-top:2px;font:14px/1.5 ${FONT};color:${MUTED};">${ratingLine(item, group)}</div>
    <div class="ssr-accent" style="margin-top:10px;font:800 22px/1.3 ${FONT};color:${ACCENT};">${headline}</div>
    ${cam ? `<div style="margin-top:2px;">${link(cam.url, `${emoji('cam')}${escape(cam.label)}`)}</div>` : ''}
    ${why ? `<div class="ssr-ink2" style="margin-top:6px;font:14px/1.45 ${FONT};color:${INK_2};">${escape(cap(why))}</div>` : ''}
    <div class="ssr-ink" style="margin-top:10px;font:700 16px/1.45 ${FONT};color:${INK};">${verdict}</div>
    ${strip}
    ${factList(facts)}
    <div style="margin-top:14px;">${button(ctaHref, cta)}</div>
  </div>`;
}

// Every other place: lighter (no accent, muted background), the headline number and one
// line; the full facts are one tap away. (Email apps can't reliably expand a section in
// place, Gmail especially, so "Details +" opens the place on the site instead.)
function lightCard({ item, group, headline, cam, line, href }) {
  return `<div class="ssr-muted-card" style="background:${MUTED_BG};border:1px solid #e1e7ec;border-radius:12px;padding:12px 14px;margin-bottom:12px;">
    <div class="ssr-ink2" style="font:700 16px/1.35 ${FONT};color:${INK_2};">${escape(item.name)} <span class="ssr-accent" style="font-weight:600;color:${ACCENT};white-space:nowrap;">${headline}</span></div>
    <div class="ssr-muted" style="margin-top:1px;font:13px/1.45 ${FONT};color:${MUTED};">${ratingLine(item, group)}</div>
    ${cam ? `<div style="margin-top:2px;">${link(cam.url, `${emoji('cam')}${escape(cam.label)}`, 13)}</div>` : ''}
    <div class="ssr-ink2" style="margin-top:4px;font:14px/1.45 ${FONT};color:${INK_2};">${line}</div>
    <div style="margin-top:4px;">${link(href, 'Details +', 13)}</div>
  </div>`;
}

// Conditions that are the same at several places, stated once
function sharedBox(where, facts) {
  if (!facts.length) return '';
  return `<div class="ssr-shared" style="background:${SHARED_BG};border:1px dashed #7fa6bf;border-radius:12px;padding:12px 14px;margin-bottom:14px;">
    <div class="ssr-ink" style="font:700 14px/1.4 ${FONT};color:${INK};">${emoji('shared')}Shared today <span class="ssr-muted" style="font-weight:400;color:${MUTED};">at ${escape(where)}</span></div>
    ${factList(facts)}
  </div>`;
}

function footerHtml(manage, what) {
  return `<b class="ssr-ink2" style="color:${INK_2};">${BRAND}</b> · ${escape(what)} It isn’t a marketing email.<br>
    <a href="${escape(manage)}" style="color:${INK_2};text-decoration:underline;">Manage alerts</a> (turn them off, or change places and thresholds)<br>
    Conditions are forecasts, not guarantees. Check before you go.`;
}
const footerText = (manage, what) => `${BRAND} · ${what} It isn't a marketing email.\nManage alerts (turn them off, or change places and thresholds): ${manage}\nConditions are forecasts, not guarantees. Check before you go.`;
const joinNames = (l) => (l.length > 1 ? `${l.slice(0, -1).join(', ')} and ${l.at(-1)}` : l[0] ?? '');

// Split facts into the ones EVERY place in the email has, word for word (same tide
// station, same buoy, same water, same swell period), stated once in "Shared today",
// and each place's own. A fact only some places share stays on the top card, so
// "Shared today at A, B and C" is always true. Same input, same split, every run.
const SHAREABLE = new Set(['tide', 'buoy', 'wetsuit', 'period']);
function splitShared(cards) {
  const key = ([k, label, value]) => `${k}|${label}|${value}`;
  const isShared = (f) => cards.length > 1 && SHAREABLE.has(f[0]) && cards.every((c) => c.facts.some((t) => key(t) === key(f)));
  const shared = cards[0].facts.filter(isShared);
  const where = shared.length ? cards.map((c) => c.item.name) : [];
  return { shared, where, cards: cards.map((c) => ({ ...c, facts: c.facts.filter((f) => !isShared(f)) })) };
}

// ---------- Surf alert ----------

export function surfEmail({ user, alerts, items, siteUrl, dateLabel, lookAhead, tides = {}, skills }) {
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
    x.number = `${d0.ft} ft @ ${Math.round(d0.s)} s`;
    x.headline = `${x.number} ${d0.when}`;
    const w = x.windDay?.window;
    const sw = mainSwell(x.waveDay);
    const swellBit = sw ? `, ${compass(sw[2])} ${swellKind(sw[1])}` : '';
    x.windowShort = w?.from != null ? `cleanest ${hourRange(w.from, w.to)}${x.when === 'today' ? '' : ` ${dayShort(d0.date)}`}` : windowText(w);
    if (w?.from != null) {
      const windBit = x.windDay?.relative === 'offshore' ? 'offshore' : 'light wind';
      x.verdict = `Best window: ${x.day} ${hourRange(w.from, w.to)}, ${windBit}${swellBit}.${w.badFrom != null ? ` ${cap(w.badRel ?? 'windy')} after ${hourText(w.badFrom)}.` : ''}`;
    } else {
      x.verdict = `Best bet: ${x.day}${swellBit}.${windowText(w) ? ` ${cap(windowText(w))}.` : ''}`;
    }
    x.cam = camLink(x.item);
    x.href = `${siteUrl}#surf/${x.item.id}`;
  }
  const top = spots[0];
  const score = (s) => s.item.rating?.score;
  const best = Math.max(...spots.map((s) => score(s) ?? 0));
  const quiet = top.v.key === 'skip';
  const subject = quiet
    ? `Surf alert: nothing above ${best}/5 ${lookText(lookAhead)} · best is ${top.item.name}`
    : `Surf alert: ${top.item.name}${spots.length > 1 ? ` + ${spots.length - 1} more` : ''}, ${top.headline} (rated ${score(top)}/5)`;
  const verdictLine = quiet
    ? `Nothing worth going for — best is ${top.item.name}, ${score(top)}/5`
    : `${top.item.name} is ${top.v.label} · ${score(top)}/5${top.windowShort ? ` — ${top.windowShort}` : ''}`;
  const sub = `${top.group ? `${top.group} · ` : ''}${plural(spots.length, 'beach', 'beaches')} on your watchlist`;

  const factsOf = (x) => {
    const d0 = x.a.days[0];
    const label = x.when === 'today' ? 'Today' : dayShort(d0.date);
    const buoy = buoyLine(x.item);
    const buoyWater = buoy && ok(x.item.buoy) ? x.item.buoy.data.waterTempF : null;
    const water = buoyWater ?? (ok(x.item.waves) ? x.item.waves.data.seaSurfaceTempF : null);
    const wind = x.windDay;
    const main = mainSwell(x.waveDay);
    const tide = tideLine(tides[x.item.tideStation], d0.date, x.when === 'today');
    return [
      ['waves', `${label} waves`, swellLine(x.waveDay)],
      main ? ['period', 'Period', `${Math.round(main[1])} s — ${periodMeaning(main[1])}`] : null,
      wind ? ['wind', `${label} ${hourText(Number(x.item.wind.data.forTime?.slice(11, 13) ?? 7))} wind`, `${compass(wind.deg)} ${wind.mph} mph${wind.gust != null ? `, gusts ${wind.gust}` : ''} (${wind.relative})`] : null,
      tide ? ['tide', `${label} tides`, tide] : null,
      x.when === 'today' && buoy ? ['buoy', 'Buoy now', buoy] : null,
      water != null ? ['wetsuit', 'Wetsuit', `${Math.round(water)}°F water — ${wetsuit(water)}`] : null,
      wind?.airHigh != null ? ['air', `${label} air`, `High ${wind.airHigh}°F`] : null,
      boardLine(x.waveDay, profile, skills) ? ['board', 'Board', boardLine(x.waveDay, profile, skills)] : null,
    ].filter(Boolean);
  };
  const split = splitShared(spots.map((x) => ({ item: x.item, facts: factsOf(x) })));
  const t = split.cards[0];

  const strip = (x) => {
    const goodDates = new Set(x.a.days.map((d) => d.date));
    const days = (ok(x.item.waves) ? x.item.waves.data.days ?? [] : []).slice(0, lookAhead);
    return { days, html: barStrip(days.map((d) => ({ top: d.date === days[0]?.date ? 'Today' : dayShort(d.date), value: d.ft ?? 0, label: `${d.ft} ft`, best: d.date === x.a.days[0].date })), `Waves by day (${x.a.days.map((d) => d.when).join(', ')} fit you)`), goodDates };
  };
  const topStrip = strip(top);
  const cta = quiet ? `See ${top.item.name}'s forecast →` : `See ${top.when === 'today' ? "today's window" : dayLong(top.a.days[0].date)} at ${top.item.name} →`;
  const others = spots.slice(1);
  const body = [
    sectionLabel('Top pick', true),
    topCard({ item: top.item, group: top.group, headline: escape(top.number), cam: top.cam, verdict: `${emoji('window')}${escape(top.verdict)}`, strip: topStrip.html, facts: t.facts, cta, ctaHref: top.href }),
    split.shared.length && split.where.length > 1 ? sharedBox(joinNames(split.where), split.shared) : '',
    others.length ? sectionLabel('Also on your list') : '',
    ...others.map((x) => lightCard({ item: x.item, group: x.group, headline: escape(x.headline), cam: x.cam, line: `${emoji('window')}${escape(x.verdict)}`, href: x.href })),
  ].join('');

  const what = `Your daily surf alert: you turned on surf alerts, looking ${lookAhead} days ahead, and these beaches matched.`;
  const html = shell({
    title: subject,
    preheader: [others.length ? `Also: ${others.map((x) => x.item.name).join(', ')}` : null, (() => { const w = t.facts.concat(split.shared).find((f) => f[0] === 'wetsuit'); return w ? w[2] : null; })()].filter(Boolean).join('. '),
    header: headerCard({ kicker: `${emoji('surf')}Surf alert · ${escape(dateLabel)}`, verdict: escape(verdictLine), sub }),
    body,
    footer: footerHtml(`${siteUrl}#alerts`, what),
  });
  const text = [
    `${emojiText('surf')}SURF ALERT · ${dateLabel}`,
    verdictLine,
    sub,
    '',
    'TOP PICK',
    `${top.item.name} (${place(top.item)}) · ${score(top)}/5 today`,
    `  ${top.number}`,
    top.cam ? `  ${top.cam.label.replace(/ →$/, '')}: ${top.cam.url}` : null,
    ratingWhy(top.item.rating) ? `  ${cap(ratingWhy(top.item.rating))}` : null,
    `  ${top.verdict}`,
    `  Waves by day: ${topStrip.days.map((d) => `${dayShort(d.date)} ${d.ft} ft`).join(', ')}`,
    ...t.facts.map(([, label, value]) => `  ${label}: ${value}`),
    `  ${cta.replace(/ →$/, '')}: ${top.href}`,
    ...(split.shared.length && split.where.length > 1 ? ['', `SHARED TODAY at ${joinNames(split.where)}`, ...split.shared.map(([, label, value]) => `  ${label}: ${value}`)] : []),
    ...(others.length ? ['', 'ALSO ON YOUR LIST'] : []),
    ...others.flatMap((x) => [
      `${x.item.name} (${place(x.item)}) · ${score(x)}/5 today`,
      `  ${x.headline}`,
      x.cam ? `  ${x.cam.label.replace(/ →$/, '')}: ${x.cam.url}` : null,
      `  ${x.verdict}`,
      `  Details: ${x.href}`,
    ]),
    '',
    footerText(`${siteUrl}#alerts`, what),
  ].filter((l) => l !== null).join('\n');
  return { subject, text, html };
}

// ---------- Snow alert ----------

export function snowEmail({ user, alerts, items, siteUrl, dateLabel, lookAhead }) {
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
    const r = p.item;
    const forecast = ok(r.forecast) ? r.forecast.data.days : [];
    p.best = snowBest(p, forecast[0]?.date);
    p.v = verdictOf(r.rating?.score, !rideable(r));
    const snowy = (p.coming?.days ?? []).filter((d) => d.inches > 0);
    p.number = p.coming ? `${amountOf(p.coming)}" by ${dayShort(snowy.at(-1)?.date ?? p.coming.days.at(-1).date)}` : `${amountOf(p.fresh)}" fresh in 48h`;
    p.block = blocker(r);
    p.zeroBase = !isClosed(r) && ok(r.observed) && r.observed.data.depthNow === 0 && r.season?.status !== 'open';
    // Go-type wording only for a mountain that's open and rated 3+
    p.canGo = !p.block && (r.rating?.score ?? 0) >= 3;
    p.dayText = `${p.canGo ? 'Best day' : 'Most snow'}: ${p.best.text}`;
    p.href = `${siteUrl}#snow/${r.id}`;
  }
  const top = places[0];
  const score = (p) => p.item.rating?.score;
  const best = Math.max(...places.map((p) => score(p) ?? 0));
  const quiet = top.v.key === 'skip' || top.v.key === 'closed';
  const subject = quiet
    ? `Snow alert: nothing above ${best}/5 ${lookText(lookAhead)} · best is ${top.item.name}`
    : `Snow alert: ${top.item.name}${places.length > 1 ? ` + ${places.length - 1} more` : ''}, ${top.number} (rated ${score(top)}/5)`;
  const verdictLine = quiet
    ? `Nothing worth going for — best is ${top.item.name}, ${score(top)}/5`
    : `${top.item.name} is ${top.v.label} · ${score(top)}/5 — ${top.best.text}`;
  const sub = `${top.group && top.group !== 'Not rideable yet' ? `${top.group} · ` : ''}${plural(places.length, 'mountain')} on your watchlist`;

  // The top pick's facts, bound to its best day
  const r = top.item;
  const obs = ok(r.observed) ? r.observed.data : null;
  const forecast = ok(r.forecast) ? r.forecast.data.days : [];
  const ride = forecast.find((d) => d.date === top.best.rideDate) ?? forecast[0];
  const rideLabel = ride ? (ride.date === forecast[0]?.date ? 'Today' : dayShort(ride.date)) : '';
  const facts = [
    // When the season is the blocker it's already the headline: not repeated here
    top.block ? null : [null, 'Season', 'Open'],
    obs ? ['fresh', 'Fresh snow', `${obs.newSnow.h24}" in 24h · ${obs.newSnow.h48}" in 48h`] : null,
    obs?.depthNow != null ? ['base', 'Base', `${obs.depthNow}"${r.observed.modelled ? ' (modelled, natural snow only)' : ''}`] : null,
    ride ? ['air', `${rideLabel} temp`, `High ${ride.tempHigh}°, low ${ride.tempLow}°F`] : null,
    ride?.feelsLow != null ? ['feels', 'Feels like', `${ride.feelsLow}° on the lifts`] : null,
    ride?.windMax != null ? ['wind', `${rideLabel} wind`, `${ride.windDeg != null ? `${compass(ride.windDeg)} ` : ''}${ride.windMax} mph${ride.gustMax != null ? `, gusts ${ride.gustMax}` : ''}`] : null,
    r.passes?.length ? ['pass', 'Pass', passText(r)] : null,
  ].filter(Boolean);
  const days = forecast.slice(0, lookAhead);
  const maxSnow = Math.max(...days.map((x) => x.snowfall ?? 0));
  const stripHtml = barStrip(days.map((d) => ({ top: d.date === forecast[0]?.date ? 'Today' : dayShort(d.date), value: d.snowfall ?? 0, label: `${d.snowfall ?? 0}"`, best: (d.snowfall ?? 0) > 0 && d.snowfall === maxSnow })), 'Snow by day')
    + (days.length > 5 ? `<div class="ssr-muted" style="margin-top:4px;font:12px/1.4 ${FONT};color:${MUTED};">${link(top.href, 'Full week on the site →', 12)}</div>` : '');
  // A mountain you can't go to: the blocker is the headline, and the button is a forecast link, not an invitation
  const headline = top.block ? `${emoji('closed')}${escape(top.block)}` : escape(top.number);
  const cta = top.canGo ? `See ${rideLabel === 'Today' ? 'today' : dayLong(ride?.date ?? forecast[0].date)} at ${r.name} →` : `See ${r.name}'s forecast →`;
  const others = places.slice(1);
  const otherLine = (p) => (p.block ? `${emoji('closed')}${escape(p.block)}${p.zeroBase ? ' (0" base)' : ''}` : `${emoji('day')}${escape(p.dayText)}`);
  const otherText = (p) => (p.block ? `${p.block}${p.zeroBase ? ' (0" base)' : ''}` : p.dayText);
  const body = [
    sectionLabel('Top pick', true),
    topCard({ item: r, group: top.group === 'Not rideable yet' ? null : top.group, headline, cam: null, verdict: `${emoji('day')}${escape(top.dayText)}`, strip: stripHtml, facts, cta, ctaHref: top.href }),
    others.length ? sectionLabel('Also on your list') : '',
    ...others.map((p) => lightCard({ item: p.item, group: p.group === 'Not rideable yet' ? null : p.group, headline: escape(p.number), cam: null, line: otherLine(p), href: p.href })),
  ].join('');

  const what = `Your daily snow alert: you turned on snow alerts, looking ${lookAhead} days ahead, and these mountains matched.`;
  const html = shell({
    title: subject,
    preheader: [others.length ? `Also: ${others.map((p) => p.item.name).join(', ')}` : null, obs?.depthNow != null ? `${r.name} base ${obs.depthNow}"` : null].filter(Boolean).join('. '),
    header: headerCard({ kicker: `${emoji('snow')}Snow alert · ${escape(dateLabel)}`, verdict: escape(verdictLine), sub }),
    body,
    footer: footerHtml(`${siteUrl}#alerts`, what),
  });
  const text = [
    `${emojiText('snow')}SNOW ALERT · ${dateLabel}`,
    verdictLine,
    sub,
    '',
    'TOP PICK',
    `${r.name} (${place(r)}) · ${score(top)}/5 today`,
    `  ${top.block ?? top.number}`,
    ratingWhy(r.rating) ? `  ${cap(ratingWhy(r.rating))}` : null,
    `  ${top.dayText}`,
    `  Snow by day: ${days.map((d) => `${dayShort(d.date)} ${d.snowfall ?? 0}"`).join(', ')}`,
    ...facts.map(([, label, value]) => `  ${label}: ${value}`),
    `  ${cta.replace(/ →$/, '')}: ${top.href}`,
    ...(others.length ? ['', 'ALSO ON YOUR LIST'] : []),
    ...others.flatMap((p) => [
      `${p.item.name} (${place(p.item)}) · ${score(p)}/5 today`,
      `  ${p.number}`,
      `  ${otherText(p)}`,
      `  Details: ${p.href}`,
    ]),
    '',
    footerText(`${siteUrl}#alerts`, what),
  ].filter((l) => l !== null).join('\n');
  return { subject, text, html };
}

// ---------- Weekly digest ----------
// watched: { snow: [{ item }], surf: [{ item, best }] } (best = the biggest day that fits you)

export function digestEmail({ user, watched, siteUrl, dateLabel, firstOne = false, surfDays = 3 }) {
  const SHOW = 3;
  const snow = watched.snow.map(({ item }) => {
    const days = ok(item.forecast) ? item.forecast.data.days.slice(0, 7) : [];
    const best = days.reduce((m, d) => ((d.snowfall ?? 0) > (m?.snowfall ?? 0) ? d : m), null);
    const block = blocker(item);
    return { item, name: item.name, link: `${siteUrl}#snow/${item.id}`, closed: !rideable(item), value: best?.snowfall ?? 0,
      head: best && best.snowfall > 0 ? `${best.snowfall}" ${dayShort(best.date)}` : 'no snow',
      line: block && !rideable(item) ? `${emoji('closed')}${escape(block)}` : best ? `${emoji('day')}Most snow: ${best.snowfall}" ${dayLong(best.date)}` : 'No snow in the 7-day forecast',
      lineText: block && !rideable(item) ? block : best ? `Most snow: ${best.snowfall}" ${dayLong(best.date)}` : 'No snow in the 7-day forecast' };
  }).sort((a, b) => Number(a.closed) - Number(b.closed) || b.value - a.value || a.name.localeCompare(b.name));
  const surf = watched.surf.map(({ item, best: fit }) => {
    const days = ok(item.waves) ? item.waves.data.days.slice(0, 7) : [];
    const link = `${siteUrl}#surf/${item.id}`;
    if (fit) {
      const idx = days.findIndex((d) => d.date === fit.date);
      const past = idx >= surfDays ? ` (past your ${surfDays}-day alert window)` : '';
      const t = `Fits you ${dayLong(fit.date)}${past}`;
      return { item, name: item.name, link, value: 100 + fit.ft, head: `${fit.ft} ft @ ${Math.round(fit.s)} s`, line: `${emoji('day')}${escape(t)}`, lineText: t };
    }
    const big = days.reduce((m, d) => (d.ft > (m?.ft ?? -1) ? d : m), null);
    const t = big ? `Nothing that fits you in 7 days (biggest: ${big.ft} ft ${dayLong(big.date)})` : 'No wave forecast right now';
    return { item, name: item.name, link, value: 0, head: '', line: escape(t), lineText: t };
  }).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  const total = snow.length + surf.length;
  const lead = snow.find((x) => x.value > 0 && !x.closed) ?? surf[0];
  const subject = firstOne
    ? `You're set up: watching ${plural(total, 'place')}`
    : `Nothing hit your thresholds this week${lead ? ` · best ahead: ${lead.name}` : ''}`;
  const why = `Alerts go out when a day reaches your snow amount, or when waves fit your level and board within ${surfDays} days. None did, so here's the best of the 7 days ahead.`;
  const verdictLine = firstOne ? `You're set up: watching ${plural(total, 'place')}` : 'Quiet week: nothing hit your thresholds';
  const sub = firstOne ? 'Alerts arrive in the morning when something matches' : 'Best of the 7 days ahead at the places you watch';
  const cards = (rows) => rows.slice(0, SHOW).map((r) => lightCard({ item: r.item, group: null, headline: escape(r.head), cam: r.item.camUrl ? camLink(r.item) : null, line: r.line, href: r.link })).join('');
  const body = [
    `<div class="ssr-ink2" style="margin:0 0 4px;font:15px/1.5 ${FONT};color:${INK_2};">${emoji('alerts')}${escape(firstOne ? 'Your alerts are working. When something matches, it lands here in the morning.' : why)}</div>`,
    snow.length ? sectionLabel('Mountains') + cards(snow) : '',
    surf.length ? sectionLabel('Beaches') + cards(surf) : '',
    `<div style="margin-top:6px;">${link(`${siteUrl}#alerts`, `See all ${plural(total, 'place')} →`, 15)}</div>`,
  ].join('');
  const what = firstOne
    ? 'Alerts only arrive on mornings something matches your thresholds; if nothing does for a week, you get a short note like this instead.'
    : 'The weekly digest: nothing matched your alert thresholds in the past week.';
  const html = shell({
    title: subject,
    preheader: firstOne ? 'Your alerts are working.' : (lead ? `Best ahead: ${lead.name}. ${lead.lineText}.` : 'A quiet week ahead too.'),
    header: headerCard({ kicker: `${emoji('digest')}Weekly digest · ${escape(dateLabel)}`, verdict: escape(verdictLine), sub }),
    body,
    footer: footerHtml(`${siteUrl}#alerts`, what),
  });
  const text = [
    `${emojiText('digest')}WEEKLY DIGEST · ${dateLabel}`,
    verdictLine,
    sub,
    '',
    firstOne ? 'Your alerts are working. When something matches, it lands here in the morning.' : why,
    ...(snow.length ? ['', 'MOUNTAINS', ...snow.slice(0, SHOW).map((r) => `- ${r.name}${r.head ? `: ${r.head}` : ''}. ${r.lineText}`)] : []),
    ...(surf.length ? ['', 'BEACHES', ...surf.slice(0, SHOW).map((r) => `- ${r.name}${r.head ? `: ${r.head}` : ''}. ${r.lineText}`)] : []),
    '',
    `See all ${plural(total, 'place')}: ${siteUrl}#alerts`,
    '',
    footerText(`${siteUrl}#alerts`, what),
  ].join('\n');
  return { subject, text, html };
}

// ---------- Confirm a new address ----------

export function confirmationEmail({ user, link: href }) {
  const name = firstName(user);
  const subject = 'Confirm your email for Snow & Surf alerts';
  const html = shell({
    title: subject,
    preheader: 'One tap to start getting alerts at this address.',
    header: headerCard({ kicker: 'Confirm your email', verdict: 'Get your Snow &amp; Surf alerts here?', sub: '' }),
    body: `<p class="ssr-ink" style="margin:0 0 6px;font:15px/1.5 ${FONT};color:${INK};">${name ? `Hi ${escape(name)},` : 'Hi,'}</p>
      <p class="ssr-ink2" style="margin:0 0 14px;font:15px/1.5 ${FONT};color:${INK_2};">Tap the button to send your ${BRAND} alerts to this address.</p>
      ${button(href, 'Confirm my email')}
      <p class="ssr-muted" style="margin:16px 0 0;font:13px/1.6 ${FONT};color:${MUTED};">Or copy this link into your browser:<br><span style="word-break:break-all;">${escape(href)}</span></p>`,
    footer: `If you didn't ask for this, ignore this email and nothing will be sent here.<br><b>${BRAND}</b>`,
  });
  const text = `${name ? `Hi ${name},` : 'Hi,'}\n\nTap this link to get ${BRAND} alerts at this address:\n\n${href}\n\nIf you didn't ask for this, ignore this email and nothing will be sent here.`;
  return { subject, text, html };
}
