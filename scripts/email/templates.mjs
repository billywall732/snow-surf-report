// The emails people get: a snow alert, a surf alert, and the "confirm your
// address" email. Each comes as { subject, text, html }.
//
// Email apps are much pickier than browsers: layout uses tables, every style is
// written on the element itself (no stylesheet), and there are no web fonts,
// scripts or SVG. Widths top out at 600px and shrink on phones (nothing sits side
// by side that can't wrap). Every icon is an emoji with a text label next to it,
// and the one image (the site's icon) has alt text, so the email reads the same
// with images blocked. No tracking pixels.

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
// One icon per kind of information, always shown with its label
const ICON = { snow: '❄️', surf: '🏄', wind: '💨', temp: '🌡️', tide: '🌊', waves: '🌊', water: '💧', rating: '⭐', base: '🏔️', date: '📅', uv: '☀️', opens: '🗓️' };

export const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const firstName = (user) => (user.name ? user.name.trim().split(/\s+/)[0] : '');
const place = (item) => (item.city ? `${item.city}, ${item.region}` : item.region);
const dayShort = (date) => new Date(`${date}T12:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const stars = (score) => '★'.repeat(score) + '☆'.repeat(5 - score);
// An icon and its label: "❄️ Snow". The emoji is decoration; the word carries the meaning.
const iconLabel = (key, label) => `<span style="font-size:15px;" aria-hidden="true">${ICON[key]}</span>&nbsp;${escape(label)}`;

// ---------- Building blocks ----------

// The page every email sits in: the inbox preview line, a header band (icon, brand,
// what this is, the date), a greeting, "at a glance", the details and the footer.
function shell({ kind = 'plain', preheader, kicker, title, dateLabel, intro, glance, body, footer }) {
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
<body style="margin:0;padding:0;background:#eef1f5;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#eef1f5;">${escape(preheader)}&#8203;&#8199;&#8203;&#8199;&#8203;&#8199;&#8203;&#8199;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef1f5;">
  <tr><td align="center" style="padding:20px 10px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
      <tr><td style="background:#ffffff;border:1px solid ${RULE};border-radius:14px;overflow:hidden;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="background:${c.main};background-image:linear-gradient(135deg,${c.main},${c.deep});padding:20px 24px 22px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              <td style="vertical-align:middle;padding-right:10px;"><img src="${LOGO}" width="32" height="32" alt="${BRAND} icon" style="display:block;width:32px;height:32px;border:0;border-radius:8px;background:#ffffff;color:#ffffff;font:600 10px ${FONT};"></td>
              <td style="vertical-align:middle;font:700 14px/1.3 ${FONT};color:#ffffff;letter-spacing:.02em;">${BRAND}</td>
            </tr></table>
            ${kicker ? `<div style="margin-top:16px;font:700 12px/1.4 ${FONT};color:#ffffff;opacity:.9;letter-spacing:.1em;text-transform:uppercase;">${kicker}</div>` : ''}
            <div style="margin-top:4px;font:800 25px/1.25 ${FONT};color:#ffffff;">${escape(title)}</div>
            ${dateLabel ? `<div style="margin-top:6px;font:14px/1.4 ${FONT};color:#ffffff;opacity:.9;">${iconLabel('date', dateLabel)}</div>` : ''}
          </td></tr>
          ${intro ? `<tr><td style="padding:22px 24px 4px;font:16px/1.55 ${FONT};color:${INK};">${intro}</td></tr>` : ''}
          ${glance ? `<tr><td style="padding:14px 24px 4px;">${glance}</td></tr>` : ''}
          <tr><td style="padding:14px 24px 22px;">${body}</td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:18px 10px 0;font:13px/1.6 ${FONT};color:${MUTED};text-align:center;">${footer}</td></tr>
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

// "⭐ Rating ★★★☆☆ 3/5"
function ratingHtml(score) {
  if (score == null) return '';
  return `${iconLabel('rating', 'Rating')} <span style="color:#d29a00;letter-spacing:1px;">${stars(score)}</span> <b style="color:${INK};">${score}/5</b>`;
}

// "Conditions at a glance": one line per place, then its rating and when
function glanceBox(kind, rows) {
  const c = COLORS[kind];
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${c.light};border-radius:10px;">
    <tr><td style="padding:14px 16px 6px;font:700 12px/1.4 ${FONT};color:${c.deep};letter-spacing:.08em;text-transform:uppercase;">Conditions at a glance</td></tr>
    ${rows.map((r, i) => `<tr><td style="padding:6px 16px ${i === rows.length - 1 ? 14 : 6}px;${i ? `border-top:1px solid ${RULE};` : ''}">
      <div style="font:700 16px/1.35 ${FONT};color:${INK};">${iconLabel(kind, `${c.name}:`)} ${escape(r.name)} <span style="font-weight:600;color:${c.main};">&mdash; ${escape(r.headline)}</span></div>
      <div style="margin-top:2px;font:13px/1.5 ${FONT};color:${INK_2};">${[r.score != null ? `${stars(r.score)} ${r.score}/5` : null, r.when].filter(Boolean).map(escape).join(' &nbsp;·&nbsp; ')}</div>
    </td></tr>`).join('')}
  </table>`;
}

// Small day boxes that wrap onto a second line on narrow phones: [['Sat', '7.2"', highlighted], ...]
function dayStrip(cells, c) {
  if (!cells.length) return '';
  return `<div style="margin:12px 0 0;font-size:0;line-height:0;">${cells.map(([top, bottom, on]) => `<div style="display:inline-block;vertical-align:top;width:58px;margin:0 6px 6px 0;padding:7px 0;text-align:center;border-radius:8px;background:${on ? c.light : '#f6f8fa'};border:1px solid ${on ? c.main : RULE};">
      <div style="font:600 11px/1.3 ${FONT};color:${MUTED};text-transform:uppercase;letter-spacing:.04em;">${escape(top)}</div>
      <div style="font:700 15px/1.3 ${FONT};color:${on ? c.main : INK_2};">${escape(bottom)}</div>
    </div>`).join('')}</div>`;
}

// Labeled facts, one per line so they never squeeze on a phone: [[iconKey, label, value], ...]
function factList(facts) {
  if (!facts.length) return '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;border-top:1px solid ${RULE};">
    ${facts.map(([key, label, value]) => `<tr>
      <td style="padding:7px 10px 7px 0;font:14px/1.45 ${FONT};color:${MUTED};white-space:nowrap;vertical-align:top;width:1%;">${iconLabel(key, label)}</td>
      <td style="padding:7px 0;font:600 14px/1.45 ${FONT};color:${INK};vertical-align:top;">${escape(value)}</td>
    </tr>`).join('')}
  </table>`;
}

// One place: name, where, rating, the headline, the days, the facts and a button
function placeCard({ c, kind, item, link, headline, sub, strip, facts, cta }) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;border:1px solid ${RULE};border-top:4px solid ${c.main};border-radius:10px;">
    <tr><td style="padding:16px 18px 18px;">
      <div style="font:700 12px/1.4 ${FONT};color:${c.main};letter-spacing:.06em;text-transform:uppercase;">${iconLabel(kind, kind === 'snow' ? 'Mountain' : 'Surf spot')}</div>
      <a href="${escape(link)}" style="display:block;margin-top:4px;font:800 20px/1.3 ${FONT};color:${INK};text-decoration:none;">${escape(item.name)}</a>
      <div style="margin-top:2px;font:14px/1.5 ${FONT};color:${MUTED};">${escape(place(item))}</div>
      ${item.rating?.score != null ? `<div style="margin-top:6px;font:14px/1.5 ${FONT};color:${INK_2};">${ratingHtml(item.rating.score)}</div>` : ''}
      <div style="margin-top:12px;font:800 22px/1.25 ${FONT};color:${c.main};">${escape(headline)}</div>
      ${sub ? `<div style="margin-top:2px;font:15px/1.5 ${FONT};color:${INK_2};">${escape(sub)}</div>` : ''}
      ${strip}
      ${factList(facts)}
      <div style="margin-top:16px;">${button(link, cta, c.main)}</div>
    </td></tr>
  </table>`;
}

// What this email is, how to change it, and that it isn't marketing
function footerHtml(manage, what) {
  return `${escape(what)} It isn’t a marketing email.<br>
    <a href="${escape(manage)}" style="color:${INK_2};text-decoration:underline;">Change your alert settings</a> (the Notifications tab) &nbsp;·&nbsp;
    <a href="${escape(manage)}" style="color:${INK_2};text-decoration:underline;">Unsubscribe</a><br>
    <span style="color:#9aa4ae;">${BRAND} · Conditions are forecasts, not guarantees. Check before you go.</span>`;
}
const footerText = (manage, what) => `${what} It isn't a marketing email.\nChange your alert settings (Notifications tab) or unsubscribe: ${manage}\nConditions are forecasts, not guarantees. Check before you go.`;

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
  const score = (p) => p.item.rating?.score;
  // Specific: the place, what's happening, and its rating
  const subject = places.length === 1
    ? `Snow alert: ${top.item.name}, ${headlineOf(top)}${score(top) != null ? ` (rated ${score(top)}/5)` : ''}`
    : `Snow alert: ${top.item.name} + ${places.length - 1} more, ${headlineOf(top)}`;
  const name = firstName(user);
  const when = (p) => (p.coming?.days?.length ? `Next ${plural(p.coming.days.length, 'day')}` : 'Last 48 hours');

  const cards = places.map((p) => {
    const r = p.item;
    const link = `${siteUrl}#snow/${r.id}`;
    const obs = r.observed?.status === 'ok' ? r.observed.data : null;
    const today = r.forecast?.status === 'ok' ? r.forecast.data.days[0] : null;
    const days = p.coming?.days ?? [];
    return placeCard({
      c,
      kind: 'snow',
      item: r,
      link,
      headline: headlineOf(p),
      sub: p.coming && p.fresh ? `Plus ${p.fresh.title.split(': ')[1]} in the last 48 hours` : (p.coming ? `Over the next ${days.length} days` : 'Fell in the last 48 hours'),
      strip: dayStrip(days.map((d) => [dayShort(d.date), `${d.inches}"`, d.inches > 0]), c),
      facts: [
        days.length ? ['snow', 'Snowfall', days.filter((d) => d.inches > 0).map((d) => `${dayShort(d.date)} ${d.inches}"`).join(', ') || 'None in the forecast'] : null,
        obs?.depthNow != null ? ['base', 'Base', `${obs.depthNow}"`] : null,
        today ? ['temp', 'Temperature today', `${today.tempHigh}° / ${today.tempLow}°F`] : null,
        today?.windMax != null ? ['wind', 'Wind today', `${today.windMax} mph${today.gustMax != null ? `, gusts ${today.gustMax}` : ''}`] : null,
        r.season?.status === 'closed' && r.season.opensOn ? ['opens', 'Opens', new Date(`${r.season.opensOn}T12:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })] : null,
      ].filter(Boolean),
      cta: 'See the full forecast',
    });
  }).join('');

  const intro = `<p style="margin:0 0 6px;">${name ? `Good morning, ${escape(name)}.` : 'Good morning.'}</p>
    <p style="margin:0;color:${INK_2};">${places.length === 1 ? 'One of your mountains matches' : `${plural(places.length, 'mountain')} match`} your snow alert.</p>`;
  const what = `This is your daily snow alert from ${BRAND}: you turned on snow alerts, looking ${lookAhead} days ahead, and these mountains matched.`;
  const html = shell({
    kind: 'snow',
    preheader: places.map(headlineOfShort).join(' · '),
    kicker: `${ICON.snow} Snow alert`,
    title: places.length === 1 ? `${headlineOf(top)} at ${top.item.name}` : `${plural(places.length, 'mountain')} getting snow`,
    dateLabel,
    intro,
    glance: glanceBox('snow', places.map((p) => ({ name: p.item.name, headline: headlineOf(p), score: score(p), when: when(p) }))),
    body: cards,
    footer: footerHtml(`${siteUrl}#alerts`, what),
  });
  const text = [
    `${BRAND}: SNOW ALERT for ${dateLabel}`,
    '',
    'CONDITIONS AT A GLANCE',
    ...places.map((p) => `- ${p.item.name}: ${headlineOf(p)}${score(p) != null ? ` (rated ${score(p)}/5)` : ''}`),
    '',
    ...places.map((p) => {
      const today = p.item.forecast?.status === 'ok' ? p.item.forecast.data.days[0] : null;
      const obs = p.item.observed?.status === 'ok' ? p.item.observed.data : null;
      return [
        `${p.item.name} (${place(p.item)})`,
        `  Snow: ${headlineOf(p)}${p.coming?.days?.length ? ` (${p.coming.days.map((d) => `${dayShort(d.date)} ${d.inches}"`).join(', ')})` : ''}`,
        p.coming && p.fresh ? `  Plus ${p.fresh.title.split(': ')[1]} in the last 48 hours` : null,
        obs?.depthNow != null ? `  Base: ${obs.depthNow}"` : null,
        today ? `  Temperature today: ${today.tempHigh}° / ${today.tempLow}°F` : null,
        today?.windMax != null ? `  Wind today: ${today.windMax} mph` : null,
        `  ${siteUrl}#snow/${p.item.id}`,
      ].filter(Boolean).join('\n');
    }),
    '',
    footerText(`${siteUrl}#alerts`, what),
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

// The next high and low tide at a station from the report's predictions: "High 10:33 AM · Low 4:51 PM"
function tideLine(station) {
  if (station?.status !== 'ok' || !station.data?.events?.length) return null;
  const now = Date.now();
  const next = (type) => station.data.events.find((e) => e.type === type && Date.parse(e.t) > now);
  const at = (e) => new Date(e.t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: station.timezone || 'UTC' });
  const h = next('H'), l = next('L');
  return [h ? `High ${at(h)}` : null, l ? `Low ${at(l)}` : null].filter(Boolean).join(' · ') || null;
}

export function surfEmail({ user, alerts, items, siteUrl, dateLabel, lookAhead, profileText, tides = {} }) {
  const c = COLORS.surf;
  const spots = alerts.map((a) => ({ a, item: items.get(a.itemId) })).filter((x) => x.item);
  const whenList = (a) => a.days.map((d) => d.when);
  const first = spots[0];
  const waveOf = (a) => `${a.days[0].ft} ft @ ${a.days[0].s} s`;
  const whenOf = (a) => whenShort(whenList(a));
  const score = (s) => s.item.rating?.score;
  // Specific: the spot, the waves, when they fit, and its rating
  const subject = spots.length === 1
    ? `Surf alert: ${first.item.name}, ${waveOf(first.a)} ${whenOf(first.a)}${score(first) != null ? ` (rated ${score(first)}/5)` : ''}`
    : `Surf alert: ${first.item.name} + ${spots.length - 1} more, ${waveOf(first.a)} ${whenOf(first.a)}`;
  const name = firstName(user);

  const cards = spots.map(({ a, item: s }) => {
    const link = `${siteUrl}#surf/${s.id}`;
    const d0 = a.days[0];
    const water = s.waves?.status === 'ok' ? s.waves.data.seaSurfaceTempF : null;
    const wind = s.wind?.status === 'ok' ? s.wind.data : null;
    const goodDates = new Set(a.days.map((d) => d.date));
    const allDays = (s.waves?.status === 'ok' ? s.waves.data.days ?? [] : []).slice(0, lookAhead);
    const tide = tideLine(tides[s.tideStation]);
    return placeCard({
      c,
      kind: 'surf',
      item: s,
      link,
      headline: `Fits you ${joinWhen(whenList(a))}`,
      sub: `${cap(d0.when)}: ${d0.ft} ft @ ${d0.s} s`,
      strip: dayStrip(allDays.map((d) => [dayShort(d.date), `${d.ft} ft`, goodDates.has(d.date)]), c),
      facts: [
        ['waves', 'Waves', a.days.map((d) => `${cap(d.when)} ${d.ft} ft @ ${d.s} s`).join(', ')],
        d0.wind ? ['wind', 'Wind', `${d0.wind.mph} mph ${d0.wind.relative}`] : null,
        tide ? ['tide', 'Next tides', tide] : null,
        wind?.airHighF != null ? ['temp', 'Air today', `High ${Math.round(wind.airHighF)}°F`] : null,
        water != null ? ['water', 'Water', `${Math.round(water)}°F`] : null,
        wind?.uvIndexMax != null ? ['uv', 'UV', String(Math.round(wind.uvIndexMax))] : null,
      ].filter(Boolean),
      cta: 'See the full forecast',
    });
  }).join('');

  const intro = `<p style="margin:0 0 6px;">${name ? `Good morning, ${escape(name)}.` : 'Good morning.'}</p>
    <p style="margin:0;color:${INK_2};">${spots.length === 1 ? 'One of your beaches has' : `${plural(spots.length, 'beach', 'beaches')} have`} waves that fit ${profileText ? `${/^[aeiou]/i.test(profileText) ? 'an' : 'a'} ${escape(profileText)}` : 'you'} in the next ${lookAhead} days. Highlighted days fit you.</p>`;
  const what = `This is your daily surf alert from ${BRAND}: you turned on surf alerts, looking ${lookAhead} days ahead, and these beaches matched.`;
  const html = shell({
    kind: 'surf',
    preheader: spots.map(({ a, item }) => `${item.name}: ${waveOf(a)} ${whenOf(a)}`).join(' · '),
    kicker: `${ICON.surf} Surf alert`,
    title: spots.length === 1 ? `${first.item.name} fits you ${joinWhen(whenList(first.a))}` : `${plural(spots.length, 'beach', 'beaches')} with waves for you`,
    dateLabel,
    intro,
    glance: glanceBox('surf', spots.map((x) => ({ name: x.item.name, headline: `${waveOf(x.a)} ${whenOf(x.a)}`, score: score(x), when: x.a.days[0].wind ? `${x.a.days[0].wind.mph} mph ${x.a.days[0].wind.relative} wind` : '' }))),
    body: cards,
    footer: footerHtml(`${siteUrl}#alerts`, what),
  });
  const text = [
    `${BRAND}: SURF ALERT for ${dateLabel}`,
    '',
    'CONDITIONS AT A GLANCE',
    ...spots.map((x) => `- ${x.item.name}: ${waveOf(x.a)} ${whenOf(x.a)}${score(x) != null ? ` (rated ${score(x)}/5)` : ''}`),
    '',
    ...spots.map(({ a, item }) => {
      const tide = tideLine(tides[item.tideStation]);
      return [
        `${item.name} (${place(item)})`,
        `  Fits you ${joinWhen(whenList(a))}`,
        ...a.days.map((d) => `  Waves ${d.when}: ${d.ft} ft @ ${d.s} s${d.wind ? `, wind ${d.wind.mph} mph ${d.wind.relative}` : ''}`),
        tide ? `  Next tides: ${tide}` : null,
        `  ${siteUrl}#surf/${item.id}`,
      ].filter(Boolean).join('\n');
    }),
    '',
    footerText(`${siteUrl}#alerts`, what),
  ].join('\n');
  return { subject, text, html };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// ['today', 'Sat', 'Sun'] -> "today, Sat and Sun"
function whenShort(list) {
  return list.length > 2 ? `${list[0]} and ${list.length - 1} more days` : joinWhen(list);
}
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
    footer: `If you didn't ask for this, you can ignore this email and nothing will be sent here.<br><span style="color:#9aa4ae;">${BRAND}</span>`,
  });
  const text = `${name ? `Hi ${name},` : 'Hi,'}\n\nTap this link to get Snow & Surf Report alerts at this address:\n\n${link}\n\nIf you didn't ask for this, ignore this email and nothing will be sent here.`;
  return { subject, text, html };
}
