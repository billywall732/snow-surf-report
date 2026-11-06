// The "should I go?" rules. Each rating starts at 2, gains or loses points,
// and is clamped to 1–5. Every adjustment is recorded in `factors` so you can
// see exactly why a place got its score. Thresholds come from config/ratings.json.

const clamp = (n) => Math.max(1, Math.min(5, n));
const inches = (n) => `${n}"`;

export function rateResort(resort, cfg) {
  const obs = resort.observed.status === 'ok' ? resort.observed.data : null;
  const fc = resort.forecast.status === 'ok' ? resort.forecast.data : null;
  if (!obs && !fc) return { score: null, reason: 'Not enough data to rate', factors: [] };

  let score = 2;
  const factors = [];
  const fresh = obs?.newSnow.h48 ?? 0;
  const base = obs?.depthNow ?? null;
  const upcoming = fc?.next72hIn ?? 0;

  if (fresh >= cfg.fresh48hIn.great) { score += 2; factors.push(`+2 lots of fresh snow (${inches(fresh)} / 48h)`); }
  else if (fresh >= cfg.fresh48hIn.good) { score += 1; factors.push(`+1 fresh snow (${inches(fresh)} / 48h)`); }

  if (base != null && base >= cfg.baseDepthIn.solid) { score += 1; factors.push(`+1 solid base (${inches(base)})`); }
  else if (base != null && base < cfg.baseDepthIn.thin) { score -= 1; factors.push(`-1 thin base (${inches(base)})`); }

  if (upcoming >= cfg.upcoming72hIn.good) { score += 1; factors.push(`+1 snow on the way (${inches(upcoming)} / 72h)`); }

  const parts = [];
  if (fresh > 0) parts.push(`${inches(fresh)} new in 48h`);
  if (base != null) parts.push(`${inches(base)} base`);
  if (upcoming > 0) parts.push(`${inches(upcoming)} forecast next 3 days`);
  if (!parts.length) parts.push('No new snow and none forecast');

  // A closed resort can't be a good idea today, whatever the snow is doing.
  if (resort.season.status === 'closed') {
    factors.push(`capped at ${cfg.closedScore}: closed`);
    const when = resort.season.opensOn ? `opens ${shortDate(resort.season.opensOn)}` : 'closed';
    return { score: cfg.closedScore, reason: `${capitalize(when)} · ${parts.join(', ')}`, factors };
  }
  return { score: clamp(score), reason: capitalize(parts.join(', ')), factors };
}

export function rateSpot(spot, cfg) {
  const w = spot.waves.status === 'ok' ? spot.waves.data : null;
  const wind = spot.wind.status === 'ok' ? spot.wind.data : null;
  if (!w) return { score: null, reason: 'No wave data to rate', factors: [] };

  let score = 2;
  const factors = [];
  const h = w.heightFt;
  const period = ratingPeriod(spot);
  const H = cfg.waveHeightFt;

  if (h < H.min) { score -= 1; factors.push(`-1 too small (${h} ft)`); }
  else if (h > H.max) { score -= 1; factors.push(`-1 too big (${h} ft)`); }
  else if (h >= H.idealMin && h <= H.idealMax) { score += 1; factors.push(`+1 good size (${h} ft)`); }

  if (period >= cfg.periodS.good) { score += 1; factors.push(`+1 long period (${period} s)`); }
  else if (period < cfg.periodS.short) { score -= 1; factors.push(`-1 short, choppy period (${period} s)`); }

  let windText = 'wind unknown';
  if (wind) {
    const rel = wind.relative;
    windText = `${wind.speedMph} mph ${rel}`;
    if (wind.speedMph <= cfg.wind.lightMph || rel === 'offshore') {
      score += 1;
      factors.push(`+1 clean wind (${windText})`);
    } else if (rel === 'onshore' && wind.speedMph >= cfg.wind.onshoreBadMph) {
      score -= 1;
      factors.push(`-1 onshore wind (${windText})`);
    }
  }

  return { score: clamp(score), reason: `${h} ft @ ${period} s, ${windText}`, factors };
}

// Period: prefer the buoy's *measured* dominant period (what surfers mean by
// "period"); fall back to the model's mean wave period if the buoy is down.
export function ratingPeriod(spot) {
  const b = spot.buoy?.status === 'ok' ? spot.buoy.data.dominantPeriodS : null;
  return b ?? spot.waves.data?.periodS ?? 0;
}

// Wind direction is where the wind comes FROM. Offshore wind blows from the land
// out to sea, i.e. from the opposite direction to the way the beach faces.
export function windRelative(windFromDeg, beachFacingDeg, toleranceDeg) {
  const offshoreFrom = (beachFacingDeg + 180) % 360;
  const diff = Math.abs((((windFromDeg - offshoreFrom) % 360) + 540) % 360 - 180);
  if (diff <= toleranceDeg) return 'offshore';
  if (diff >= 180 - toleranceDeg) return 'onshore';
  return 'cross-shore';
}

// The cleanest stretch of one day, from its daylight hours [{ h, mph, deg }] (local hours):
// clean = offshore, or light enough (6 mph or less) not to matter. Returns the longest
// clean run (2+ hours, the earliest if tied) and when the wind turns bad after it
// (onshore or cross-shore at 10+ mph):
//   { from: 7, to: 10, badFrom: 11 }   -> "Cleanest 7-10 AM, onshore after 11 AM"
//   { from: null, badFrom: 5 }         -> no clean stretch at all
export function cleanWindow(hours, beachFacingDeg, toleranceDeg) {
  if (!hours?.length) return null;
  const tagged = hours.map((x) => {
    const rel = x.deg == null ? null : windRelative(x.deg, beachFacingDeg, toleranceDeg);
    return { ...x, rel, clean: rel === 'offshore' || x.mph <= 6, bad: rel !== 'offshore' && x.mph >= 10 };
  });
  let best = null;
  for (let i = 0; i < tagged.length; i++) {
    if (!tagged[i].clean) continue;
    let j = i;
    while (j + 1 < tagged.length && tagged[j + 1].clean && tagged[j + 1].h === tagged[j].h + 1) j++;
    if (j - i + 1 >= 2 && (!best || j - i > best.to - best.from - 1)) best = { from: tagged[i].h, to: tagged[j].h + 1 };
    i = j;
  }
  const after = best ? best.to : tagged[0].h;
  const turn = tagged.find((x) => x.h >= after && x.bad);
  return { from: best?.from ?? null, to: best?.to ?? null, badFrom: turn?.h ?? null, badRel: turn?.rel ?? null };
}

// Highest score wins; ties go to the place with the bigger tiebreak number.
export function bestBet(items, tiebreak) {
  const rated = items.filter((x) => x.rating.score != null);
  if (!rated.length) return null;
  rated.sort((a, b) => b.rating.score - a.rating.score || tiebreak(b) - tiebreak(a));
  const top = rated[0];
  return { id: top.id, name: top.name, score: top.rating.score, reason: top.rating.reason };
}

function shortDate(iso) {
  return new Date(iso + 'T12:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
