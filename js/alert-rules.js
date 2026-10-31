// Which alerts match right now? Pure rules (no page, no storage), shared by the
// Notifications tab in the browser and the morning email script in Node.
//
// computeAlerts(report, settings, profile, pins, rider) -> [{ id, kind, hash, itemId, title, detail, days }]
//   settings: { snowOn, snowInches, snowDays, snowScope, snowWatch, surfOn, surfDays, surfScope, surfWatch }
//             snowDays / surfDays: how far ahead to look (3, 5 or 7 days)
//             scope: 'pinned' (your pinned spots), 'chosen' (the ids in snowWatch / surfWatch)
//                    or 'nearby' (everywhere within your travel distance, from your Rider Profile)
//   profile:  { levels: [...], boards: [...] }
//   pins:     { snow: [ids], surf: [ids] }
//   rider:    your Rider Profile (see recommend.js). Snowboarders never get alerts for
//             skiers-only mountains; beaches colder than your coldest water are skipped.
import { fitDays, hasProfile } from './fit.js';
import { EMPTY_RIDER, noSnowboards, normalizeRider, onYourPass, surfBlockers, withinReach } from './recommend.js';

export const DEFAULT_SETTINGS = {
  snowOn: true,
  snowInches: 4,
  snowDays: 3, // look this many days ahead
  snowScope: 'pinned',
  snowWatch: [], // mountains you chose for alerts (when snowScope is 'chosen')
  surfOn: true,
  surfDays: 3,
  surfScope: 'pinned',
  surfWatch: [],
};

// Is this place covered by your alerts? ('all' is from an older version of the app)
function covered(scope, item, pinned, watch, rider) {
  if (scope === 'all') return true;
  if (scope === 'nearby') return Boolean(rider.home) && withinReach(item, rider);
  return scope === 'chosen' ? watch.includes(item.id) : pinned.includes(item.id);
}

export const LOOK_AHEAD = [3, 5, 7];
const lookAhead = (n) => (LOOK_AHEAD.includes(Number(n)) ? Number(n) : 3);

// Inches of snow forecast at a mountain over the next `days` days. (For 3 days,
// the report's own 72-hour total.)
export function snowComing(r, days = 3) {
  if (r.forecast?.status !== 'ok') return 0;
  if (days === 3 && r.forecast.data.next72hIn != null) return r.forecast.data.next72hIn;
  return Math.round(r.forecast.data.days.slice(0, days).reduce((t, d) => t + (d.snowfall ?? 0), 0) * 10) / 10;
}

const dayName = (date) => new Date(`${date}T12:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
const ok = (b) => b?.status === 'ok';

export function computeAlerts(report, settings, profile, pins, riderIn = EMPTY_RIDER) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const rider = normalizeRider(riderIn);
  const alerts = [];
  const date = report.generatedAt.slice(0, 10);

  if (s.snowOn) {
    for (const r of report.sections.snow.items) {
      if (!covered(s.snowScope, r, pins.snow ?? [], s.snowWatch ?? [], rider)) continue;
      if (noSnowboards(r, rider)) continue; // skiers only, and you snowboard
      if (s.snowScope === 'nearby' && !onYourPass(r, rider)) continue;
      const n = lookAhead(s.snowDays);
      const coming = snowComing(r, n);
      const fresh = ok(r.observed) ? r.observed.data.newSnow.h48 ?? 0 : 0;
      if (coming >= s.snowInches) {
        const days = r.forecast.data.days.slice(0, n).map((d) => ({ date: d.date, inches: d.snowfall ?? 0 }));
        const snowyDays = days.filter((d) => d.inches > 0).map((d) => `${dayName(d.date)} ${d.inches}"`);
        alerts.push({ id: `snow:${r.id}:${date}`, kind: 'snow', hash: `snow/${r.id}`, itemId: r.id, title: `${r.name}: ${coming}" of snow coming`, detail: `Next ${n} days: ${snowyDays.join(' · ') || 'see forecast'}`, days });
      }
      if (fresh >= s.snowInches) {
        alerts.push({ id: `fresh:${r.id}:${date}`, kind: 'snow', hash: `snow/${r.id}`, itemId: r.id, title: `${r.name}: ${fresh}" of fresh snow`, detail: 'Fell in the last 48 hours', days: [] });
      }
    }
  }

  if (s.surfOn && hasProfile(profile)) {
    const skills = report.sections.surf.skills;
    for (const spot of report.sections.surf.items) {
      if (!covered(s.surfScope, spot, pins.surf ?? [], s.surfWatch ?? [], rider)) continue;
      if (surfBlockers(spot, rider, { checkDistance: false }).length) continue; // water too cold for you
      const days = fitDays(spot, profile, skills).slice(0, lookAhead(s.surfDays));
      const good = days.filter((d) => d.fits);
      if (!good.length) continue;
      const first = good[0];
      // "Today" is the beach's own local date (its first forecast day). The report's
      // UTC date is already tomorrow on Pacific evenings.
      const localToday = days[0].date;
      const when = (d) => (d.date === localToday ? 'today' : dayName(d.date));
      alerts.push({
        id: `surf:${spot.id}:${good.map((d) => d.date).join(',')}`,
        kind: 'surf',
        hash: `surf/${spot.id}`,
        itemId: spot.id,
        days: good.map((d) => ({ date: d.date, ft: d.ft, s: d.s, wind: d.wind, when: when(d) })),
        title: `${spot.name}: waves fit you ${good.map(when).join(', ')}`,
        detail: `${first.date === localToday ? 'Today' : dayName(first.date)}: ${first.ft} ft @ ${first.s} s${first.wind ? `, ${first.wind.mph} mph ${first.wind.relative}` : ''}`,
      });
    }
  }
  return alerts;
}

// Every place your alerts cover, with how it looks right now, so the Notifications
// tab can show what you're watching even on days nothing matches.
// watching(...) -> { snow: [{ item, status, match }], surf: [...] }
export function watching(report, settings, profile, pins, riderIn = EMPTY_RIDER) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const rider = normalizeRider(riderIn);
  const matched = new Set(computeAlerts(report, settings, profile, pins, rider).map((a) => a.hash));
  const out = { snow: [], surf: [] };
  if (s.snowOn) {
    for (const r of report.sections.snow.items) {
      if (!covered(s.snowScope, r, pins.snow ?? [], s.snowWatch ?? [], rider)) continue;
      if (s.snowScope === 'nearby' && !onYourPass(r, rider)) continue;
      const n = lookAhead(s.snowDays);
      const coming = snowComing(r, n);
      const fresh = ok(r.observed) ? r.observed.data.newSnow.h48 ?? 0 : 0;
      const status = noSnowboards(r, rider)
        ? 'Skiers only, so no alerts for you'
        : `${coming}" in the next ${n} days · ${fresh}" fresh (alerts at ${s.snowInches}")`;
      out.snow.push({ item: r, status, match: matched.has(`snow/${r.id}`) });
    }
  }
  if (s.surfOn) {
    const skills = report.sections.surf.skills;
    for (const spot of report.sections.surf.items) {
      if (!covered(s.surfScope, spot, pins.surf ?? [], s.surfWatch ?? [], rider)) continue;
      const cold = surfBlockers(spot, rider, { checkDistance: false })[0];
      let status;
      if (cold) status = cold;
      else if (!hasProfile(profile)) status = 'Set your level and board to get alerts';
      else {
        const days = fitDays(spot, profile, skills).slice(0, lookAhead(s.surfDays));
        status = days.some((d) => d.fits) ? 'Waves fit you' : `Not for you yet: ${days[0]?.reasons[0] ?? 'no forecast'}`;
      }
      out.surf.push({ item: spot, status, match: matched.has(`surf/${spot.id}`) });
    }
  }
  return out;
}
