// Which alerts match right now? Pure rules (no page, no storage), shared by the
// Notifications tab in the browser and the morning email script in Node.
//
// computeAlerts(report, settings, profile, pins, rider) -> [{ id, kind, hash, title, detail }]
//   settings: { snowOn, snowInches, snowScope, snowWatch, surfOn, surfScope, surfWatch }
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
  snowScope: 'pinned',
  snowWatch: [], // mountains you chose for alerts (when snowScope is 'chosen')
  surfOn: true,
  surfScope: 'pinned',
  surfWatch: [],
};

// Is this place covered by your alerts? ('all' is from an older version of the app)
function covered(scope, item, pinned, watch, rider) {
  if (scope === 'all') return true;
  if (scope === 'nearby') return Boolean(rider.home) && withinReach(item, rider);
  return scope === 'chosen' ? watch.includes(item.id) : pinned.includes(item.id);
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
      const coming = ok(r.forecast) ? r.forecast.data.next72hIn ?? 0 : 0;
      const fresh = ok(r.observed) ? r.observed.data.newSnow.h48 ?? 0 : 0;
      if (coming >= s.snowInches) {
        const snowyDays = r.forecast.data.days.slice(0, 3).filter((d) => d.snowfall > 0).map((d) => `${dayName(d.date)} ${d.snowfall}"`);
        alerts.push({ id: `snow:${r.id}:${date}`, kind: 'snow', hash: `snow/${r.id}`, title: `${r.name}: ${coming}" of snow coming`, detail: `Next 3 days: ${snowyDays.join(' · ') || 'see forecast'}` });
      }
      if (fresh >= s.snowInches) {
        alerts.push({ id: `fresh:${r.id}:${date}`, kind: 'snow', hash: `snow/${r.id}`, title: `${r.name}: ${fresh}" of fresh snow`, detail: 'Fell in the last 48 hours' });
      }
    }
  }

  if (s.surfOn && hasProfile(profile)) {
    const skills = report.sections.surf.skills;
    for (const spot of report.sections.surf.items) {
      if (!covered(s.surfScope, spot, pins.surf ?? [], s.surfWatch ?? [], rider)) continue;
      if (surfBlockers(spot, rider, { checkDistance: false }).length) continue; // water too cold for you
      const good = fitDays(spot, profile, skills).filter((d) => d.fits);
      if (!good.length) continue;
      const first = good[0];
      alerts.push({
        id: `surf:${spot.id}:${good.map((d) => d.date).join(',')}`,
        kind: 'surf',
        hash: `surf/${spot.id}`,
        title: `${spot.name}: waves fit you ${good.map((d) => (d.date === date ? 'today' : dayName(d.date))).join(', ')}`,
        detail: `${first.date === date ? 'Today' : dayName(first.date)}: ${first.ft} ft @ ${first.s} s${first.wind ? `, ${first.wind.mph} mph ${first.wind.relative}` : ''}`,
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
      const coming = ok(r.forecast) ? r.forecast.data.next72hIn ?? 0 : 0;
      const fresh = ok(r.observed) ? r.observed.data.newSnow.h48 ?? 0 : 0;
      const status = noSnowboards(r, rider)
        ? 'Skiers only, so no alerts for you'
        : `${coming}" in the next 3 days · ${fresh}" fresh (alerts at ${s.snowInches}")`;
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
        const days = fitDays(spot, profile, skills);
        status = days.some((d) => d.fits) ? 'Waves fit you' : `Not for you yet: ${days[0]?.reasons[0] ?? 'no forecast'}`;
      }
      out.surf.push({ item: spot, status, match: matched.has(`surf/${spot.id}`) });
    }
  }
  return out;
}
