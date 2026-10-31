// The emails people get: a snow alert, a surf alert, and the "confirm your
// address" email. Each comes as { subject, text, html }.
//
// Email apps are much pickier than browsers: layout uses tables, every style is
// written on the element itself (no stylesheet), and there are no web fonts or
// scripts. Widths top out at 600px, the usual for email, and shrink on phones.

const BRAND = 'Snow & Surf Report';
const COLORS = {
  snow: { main: '#0f6f86', light: '#e6f3f6', name: 'Snow' },
  surf: { main: '#1f63c6', light: '#e8f0fb', name: 'Surf' },
  plain: { main: '#1d2733', light: '#eef1f5', name: '' },
};
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const INK = '#16202b';
const INK_2 = '#4b5866';
const MUTED = '#7b8794';
const RULE = '#e3e8ee';

export const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const firstName = (user) => (user.name ? user.name.trim().split(/\s+/)[0] : '');
const place = (item) => (item.city ? `${item.city}, ${item.region}` : item.region);
const dayShort = (date) => new Date(`${date}T12:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------- Building blocks ----------

// The page every email sits in: a preheader (the preview line in the inbox), a
// colored header, the body, and the footer.
function shell({ kind = 'plain', preheader, kicker, title, intro, body, footer }) {
  const c = COLORS[kind];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escape(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f2f4f7;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f2f4f7;">${escape(preheader)}&#8203;&#8199;&#8203;&#8199;&#8203;&#8199;&#8203;&#8199;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f2f4f7;">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
      <tr><td style="padding:0 4px 12px;font:600 13px/1.4 ${FONT};color:${MUTED};letter-spacing:.06em;text-transform:uppercase;">${BRAND}</td></tr>
      <tr><td style="background:#ffffff;border:1px solid ${RULE};border-radius:12px;overflow:hidden;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="background:${c.main};padding:26px 28px 24px;">
            ${kicker ? `<div style="font:700 12px/1.4 ${FONT};color:#ffffff;opacity:.85;letter-spacing:.1em;text-transform:uppercase;">${escape(kicker)}</div>` : ''}
            <div style="margin-top:6px;font:700 24px/1.25 ${FONT};color:#ffffff;">${escape(title)}</div>
          </td></tr>
          <tr><td style="padding:24px 28px 8px;font:16px/1.55 ${FONT};color:${INK};">${intro}</td></tr>
          <tr><td style="padding:8px 28px 24px;">${body}</td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:18px 8px 0;font:13px/1.6 ${FONT};color:${MUTED};text-align:center;">${footer}</td></tr>
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

// "★★★☆☆ 3/5"
function ratingLine(score) {
  if (score == null) return '';
  const stars = '★'.repeat(score) + '☆'.repeat(5 - score);
  return `<span style="color:#e0a400;letter-spacing:1px;">${stars}</span> <span style="color:${INK_2};">${score}/5 today</span>`;
}

// Small day boxes that wrap onto a second line on narrow phones: [['Sat', '7.2"', highlighted], ...]
function dayStrip(cells, c) {
  if (!cells.length) return '';
  return `<div style="margin:12px 0 0;font-size:0;line-height:0;">${cells.map(([top, bottom, on]) => `<div style="display:inline-block;vertical-align:top;width:58px;margin:0 6px 6px 0;padding:7px 0;text-align:center;border-radius:8px;background:${on ? c.light : '#f6f8fa'};border:1px solid ${on ? c.main : RULE};">
      <div style="font:600 11px/1.3 ${FONT};color:${MUTED};text-transform:uppercase;letter-spacing:.04em;">${escape(top)}</div>
      <div style="font:700 15px/1.3 ${FONT};color:${on ? c.main : INK_2};">${escape(bottom)}</div>
    </div>`).join('')}</div>`;
}

// One place: name, where, rating, the headline number, details and a button
function placeCard({ c, item, link, headline, sub, strip, facts, cta }) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;border:1px solid ${RULE};border-left:5px solid ${c.main};border-radius:10px;">
    <tr><td style="padding:18px 20px;">
      <a href="${escape(link)}" style="font:700 19px/1.3 ${FONT};color:${INK};text-decoration:none;">${escape(item.name)}</a>
      <div style="margin-top:2px;font:14px/1.5 ${FONT};color:${MUTED};">${escape(place(item))}${item.rating?.score != null ? ` &nbsp;·&nbsp; ${ratingLine(item.rating.score)}` : ''}</div>
      <div style="margin-top:14px;font:700 22px/1.25 ${FONT};color:${c.main};">${escape(headline)}</div>
      ${sub ? `<div style="margin-top:2px;font:15px/1.5 ${FONT};color:${INK_2};">${escape(sub)}</div>` : ''}
      ${strip}
      ${facts.length ? `<div style="margin-top:10px;font:14px/1.6 ${FONT};color:${INK_2};">${facts.map(escape).join(' &nbsp;·&nbsp; ')}</div>` : ''}
      <div style="margin-top:16px;">${button(link, cta, c.main)}</div>
    </td></tr>
  </table>`;
}

function footerHtml(manage, why) {
  return `${escape(why)}<br>
    <a href="${escape(manage)}" style="color:${INK_2};text-decoration:underline;">Manage your alerts</a> &nbsp;·&nbsp;
    <a href="${escape(manage)}" style="color:${INK_2};text-decoration:underline;">Unsubscribe</a><br>
    <span style="color:#a0aab4;">${BRAND} · Conditions are forecasts, not guarantees. Check before you go.</span>`;
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
  const places = [...byPlace.values()].filter((p) => p.item);
  const top = places[0];
  const subject = places.length === 1
    ? `Snow alert: ${headlineOf(top)} at ${top.item.name}`
    : `Snow alert: ${places.length} of your mountains are getting snow`;
  const name = firstName(user);

  const cards = places.map((p) => {
    const r = p.item;
    const link = `${siteUrl}#snow/${r.id}`;
    const obs = r.observed?.status === 'ok' ? r.observed.data : null;
    const days = p.coming?.days ?? [];
    return placeCard({
      c,
      item: r,
      link,
      headline: headlineOf(p),
      sub: p.coming && p.fresh ? `Plus ${p.fresh.title.split(': ')[1]} in the last 48 hours` : (p.coming ? `Over the next ${days.length} days` : 'Fell in the last 48 hours'),
      strip: dayStrip(days.map((d) => [dayShort(d.date), `${d.inches}"`, d.inches > 0]), c),
      facts: [
        obs?.depthNow != null ? `Base ${obs.depthNow}"` : null,
        r.forecast?.status === 'ok' ? `Today ${r.forecast.data.days[0].tempHigh}°/${r.forecast.data.days[0].tempLow}°F` : null,
        r.season?.status === 'closed' && r.season.opensOn ? `Opens ${new Date(`${r.season.opensOn}T12:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}` : null,
      ].filter(Boolean),
      cta: 'See the full forecast',
    });
  }).join('');

  const intro = `<p style="margin:0 0 6px;">${name ? `Good morning, ${escape(name)}.` : 'Good morning.'}</p>
    <p style="margin:0;color:${INK_2};">${places.length === 1 ? 'One of your mountains matches' : `${plural(places.length, 'mountain')} match`} your snow alert for ${escape(dateLabel)}.</p>`;
  const html = shell({
    kind: 'snow',
    preheader: places.map(headlineOfShort).join(' · '),
    kicker: `Snow alert · ${dateLabel}`,
    title: places.length === 1 ? `${headlineOf(top)} at ${top.item.name}` : `${plural(places.length, 'mountain')} getting snow`,
    intro,
    body: cards,
    footer: footerHtml(`${siteUrl}#alerts`, `You're receiving this because you turned on snow alerts (looking ${lookAhead} days ahead).`),
  });
  const text = [
    `${BRAND}: snow alert for ${dateLabel}`,
    '',
    ...places.map((p) => [
      `${p.item.name} (${place(p.item)})`,
      `  ${headlineOf(p)}${p.coming?.days?.length ? `: ${p.coming.days.map((d) => `${dayShort(d.date)} ${d.inches}"`).join(', ')}` : ''}`,
      p.coming && p.fresh ? `  Plus ${p.fresh.title.split(': ')[1]} in the last 48 hours` : null,
      `  ${siteUrl}#snow/${p.item.id}`,
    ].filter(Boolean).join('\n')),
    '',
    `Manage your alerts or unsubscribe: ${siteUrl}#alerts`,
  ].join('\n');
  return { subject, text, html };
}

// "10.5" of snow coming" / "8" of fresh snow"
function headlineOf(p) {
  const a = p.coming ?? p.fresh;
  return a.title.split(': ').slice(1).join(': ');
}
const headlineOfShort = (p) => `${p.item.name}: ${headlineOf(p)}`;

// ---------- Surf alert ----------

export function surfEmail({ user, alerts, items, siteUrl, dateLabel, lookAhead, profileText }) {
  const c = COLORS.surf;
  const spots = alerts.map((a) => ({ a, item: items.get(a.itemId) })).filter((x) => x.item);
  const whenList = (a) => a.days.map((d) => d.when);
  const first = spots[0];
  const subject = spots.length === 1
    ? `Surf alert: ${first.item.name} fits you ${joinWhen(whenList(first.a))}`
    : `Surf alert: ${spots.length} of your beaches have waves that fit you`;
  const name = firstName(user);

  const cards = spots.map(({ a, item: s }) => {
    const link = `${siteUrl}#surf/${s.id}`;
    const d0 = a.days[0];
    const water = s.waves?.status === 'ok' ? s.waves.data.seaSurfaceTempF : null;
    const goodDates = new Set(a.days.map((d) => d.date));
    const allDays = (s.waves?.status === 'ok' ? s.waves.data.days ?? [] : []).slice(0, lookAhead);
    return placeCard({
      c,
      item: s,
      link,
      headline: `Fits you ${joinWhen(whenList(a))}`,
      sub: `${cap(d0.when)}: ${d0.ft} ft @ ${d0.s} s${d0.wind ? `, ${d0.wind.mph} mph ${d0.wind.relative} wind` : ''}`,
      strip: dayStrip(allDays.map((d) => [dayShort(d.date), `${d.ft} ft`, goodDates.has(d.date)]), c),
      facts: [
        water != null ? `Water ${Math.round(water)}°F` : null,
        s.wind?.status === 'ok' && s.wind.data.uvIndexMax != null ? `UV ${Math.round(s.wind.data.uvIndexMax)}` : null,
      ].filter(Boolean),
      cta: 'See the full forecast',
    });
  }).join('');

  const intro = `<p style="margin:0 0 6px;">${name ? `Good morning, ${escape(name)}.` : 'Good morning.'}</p>
    <p style="margin:0;color:${INK_2};">${spots.length === 1 ? 'One of your beaches has' : `${plural(spots.length, 'beach', 'beaches')} have`} waves that fit ${profileText ? `${/^[aeiou]/i.test(profileText) ? 'an' : 'a'} ${escape(profileText)}` : 'you'} in the next ${lookAhead} days. Highlighted days fit you.</p>`;
  const html = shell({
    kind: 'surf',
    preheader: spots.map(({ a, item }) => `${item.name}: ${joinWhen(whenList(a))}`).join(' · '),
    kicker: `Surf alert · ${dateLabel}`,
    title: spots.length === 1 ? `${first.item.name} fits you ${joinWhen(whenList(first.a))}` : `${plural(spots.length, 'beach', 'beaches')} with waves for you`,
    intro,
    body: cards,
    footer: footerHtml(`${siteUrl}#alerts`, `You're receiving this because you turned on surf alerts (looking ${lookAhead} days ahead).`),
  });
  const text = [
    `${BRAND}: surf alert for ${dateLabel}`,
    '',
    ...spots.map(({ a, item }) => [
      `${item.name} (${place(item)})`,
      `  Fits you ${joinWhen(whenList(a))}`,
      ...a.days.map((d) => `  ${cap(d.when)}: ${d.ft} ft @ ${d.s} s${d.wind ? `, ${d.wind.mph} mph ${d.wind.relative}` : ''}`),
      `  ${siteUrl}#surf/${item.id}`,
    ].join('\n')),
    '',
    `Manage your alerts or unsubscribe: ${siteUrl}#alerts`,
  ].join('\n');
  return { subject, text, html };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// ['today', 'Sat', 'Sun'] -> "today, Sat and Sun"
function joinWhen(list) {
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
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
      <p style="margin:0;color:${INK_2};">Tap the button to send your Snow &amp; Surf Report alerts to this address.</p>`,
    body: `<div style="margin:8px 0 6px;">${button(link, 'Confirm my email', COLORS.plain.main)}</div>
      <p style="margin:16px 0 0;font:13px/1.6 ${FONT};color:${MUTED};">Or copy this link into your browser:<br><span style="word-break:break-all;">${escape(link)}</span></p>`,
    footer: `If you didn't ask for this, you can ignore this email and nothing will be sent here.<br><span style="color:#a0aab4;">${BRAND}</span>`,
  });
  const text = `${name ? `Hi ${name},` : 'Hi,'}\n\nTap this link to get Snow & Surf Report alerts at this address:\n\n${link}\n\nIf you didn't ask for this, ignore this email and nothing will be sent here.`;
  return { subject, text, html };
}
