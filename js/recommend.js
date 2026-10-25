// Personal picks from your Rider Profile. Pure rules (no page, no storage), shared
// by the app ("Recommended for you", "For you") and the morning email script.
//
// rider = {
//   ski:  { ride: ['ski', 'snowboard'], levels: ['intermediate', ...], wants: ['powder', ...], passes: ['Ikon', ...] },
//   surf: { minWaterF: 60 | null },
//   home: { label, lat, lon } | null,
//   radiusMi: 250 | null (null = any distance),
// }
// profile (surf levels/boards) comes from skill.js / fit.js.
import { fitToday, hasProfile } from './fit.js';

export const EMPTY_RIDER = {
  ski: { ride: [], levels: [], wants: [], passes: [] },
  surf: { minWaterF: null },
  home: null,
  radiusMi: 300,
};

export const SKI_LEVELS = [
  ['beginner', 'Beginner', 'Learning, or happy on greens'],
  ['intermediate', 'Intermediate', 'Linking turns on blues'],
  ['advanced', 'Advanced', 'Confident on blacks and bumps'],
  ['expert', 'Expert', 'Double blacks, chutes, trees'],
];
export const RIDE_TYPES = [['ski', 'Ski', 'Two planks'], ['snowboard', 'Snowboard', 'One plank']];
export const SKI_WANTS = [
  ['powder', 'Powder days', 'Fresh and incoming snow'],
  ['groomers', 'Groomers & bluebird', 'Calm, dry days'],
  ['park', 'Terrain park', 'Jumps, rails, pipes'],
  ['steeps', 'Steeps & expert terrain', 'Lots of black runs'],
];

const ok = (b) => b?.status === 'ok';

// Distance in miles between two points (the "haversine" formula)
export function distanceMi(a, b) {
  const r = Math.PI / 180;
  const x = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return Math.round(7918 * Math.asin(Math.sqrt(x))); // Earth's diameter in miles
}

// Fill in anything missing (older saves, or a record from another device)
export function normalizeRider(r) {
  const list = (x) => (Array.isArray(x) ? x : []);
  return {
    ski: {
      ride: list(r?.ski?.ride), levels: list(r?.ski?.levels), wants: list(r?.ski?.wants), passes: list(r?.ski?.passes),
    },
    surf: { minWaterF: Number(r?.surf?.minWaterF) || null },
    home: r?.home && Number.isFinite(r.home.lat) && Number.isFinite(r.home.lon) ? r.home : null,
    radiusMi: r && 'radiusMi' in r ? (Number(r.radiusMi) || null) : EMPTY_RIDER.radiusMi,
  };
}

export const hasSkiRider = (rider) => Boolean(rider && (rider.home || rider.ski.ride.length || rider.ski.levels.length || rider.ski.wants.length || rider.ski.passes.length));
export const hasRider = (rider) => Boolean(rider && (hasSkiRider(rider) || rider.surf.minWaterF));

// "Snowboarder · intermediate, advanced · Ikon"
export function skiText(rider) {
  const ride = rider.ski.ride;
  const who = ride.length === 1 ? (ride[0] === 'ski' ? 'Skier' : 'Snowboarder') : ride.length ? 'Skier and snowboarder' : '';
  const levels = rider.ski.levels.map((l) => SKI_LEVELS.find(([v]) => v === l)?.[1].toLowerCase()).filter(Boolean);
  return [who, levels.join(', '), rider.ski.passes.join(' or ')].filter(Boolean).join(' · ');
}

const tooFar = (rider, place) => {
  if (!rider.home || !rider.radiusMi) return null;
  const d = distanceMi(rider.home, place);
  return d > rider.radiusMi ? d : null;
};

// A snowboarder (who doesn't also ski) at a skiers-only mountain like Alta
export const noSnowboards = (resort, rider) => Boolean(resort.skiersOnly && rider.ski.ride.length && !rider.ski.ride.includes('ski'));
// No pass picked = any mountain is fine
export const onYourPass = (resort, rider) => !rider.ski.passes.length || (resort.passes ?? []).some((p) => rider.ski.passes.includes(p.pass));
// Within your travel distance? (No home or "any distance" = yes)
export const withinReach = (place, rider) => !tooFar(rider, place);

// Is this mountain ruled out for you? Returns the reasons (empty = it's fine).
export function skiBlockers(resort, rider, { checkDistance = true } = {}) {
  const out = [];
  if (noSnowboards(resort, rider)) out.push('Skiers only: no snowboarding');
  if (!onYourPass(resort, rider)) out.push(`Not on your pass (${rider.ski.passes.join(' or ')})`);
  const far = checkDistance && tooFar(rider, resort);
  if (far) out.push(`${far} mi away (farther than ${rider.radiusMi} mi)`);
  return out;
}

// Points that make up a mountain's score (roughly out of 100):
//   today's conditions  8–40   (the 1–5 rating × 8)
//   size                0–18   (skiable acres: a 3,500-acre resort beats a 240-acre local hill)
//   terrain for you     0–20   (share of runs at your level; unknown counts as average)
//   what you're after   0–20   (powder, groomers, park, steeps)
//   closeness           0–8    (a gentle nudge: a big mountain a few hours away still wins)
const sizePoints = (acres) => (acres ? Math.max(0, Math.min(6, Math.log2(acres / 100))) * 3 : 6);
const closePoints = (rider, place) => (rider.home && rider.radiusMi ? Math.max(0, 1 - distanceMi(rider.home, place) / rider.radiusMi) * 8 : 0);

// How well does this mountain suit you today? { score, reasons, blockers }
export function skiFit(resort, rider) {
  const blockers = skiBlockers(resort, rider);
  const reasons = [];
  let score = (resort.rating.score ?? 1) * 8; // today's 1–5 rating is the starting point
  const t = resort.terrain;
  score += sizePoints(resort.acres);
  if (resort.acres >= 1500) reasons.push(`Big mountain (${resort.acres.toLocaleString('en-US')} acres)`);
  else if (resort.acres && resort.acres < 400) reasons.push(`Small hill (${resort.acres} acres)`);

  // Terrain that matches your level(s)
  if (rider.ski.levels.length) {
    if (t) {
      const share = {
        beginner: t.beginner, intermediate: t.intermediate, advanced: t.advanced, expert: t.expert ?? t.advanced,
      };
      const best = Math.max(...rider.ski.levels.map((l) => share[l] ?? 0));
      const bestLevel = rider.ski.levels.find((l) => (share[l] ?? 0) === best);
      const word = bestLevel === 'expert' && t.expert == null ? 'advanced' : bestLevel;
      score += best / 5; // up to +20
      if (best) reasons.push(`${best}% ${word} terrain`);
      if (rider.ski.levels.every((l) => l === 'beginner') && t.beginner < 15) {
        score -= 10;
        reasons.push('Little beginner terrain');
      }
    } else {
      score += 6; // unknown: count it as average
    }
  }

  // What you're after
  const fresh = ok(resort.observed) ? resort.observed.data.newSnow.h48 ?? 0 : 0;
  const coming = ok(resort.forecast) ? resort.forecast.data.next72hIn ?? 0 : 0;
  const today = ok(resort.forecast) ? resort.forecast.data.days[0] : null;
  if (rider.ski.wants.includes('powder') && fresh + coming > 0) {
    score += Math.min(20, (fresh + coming) * 2);
    reasons.push([fresh ? `${fresh}" fresh` : '', coming ? `${coming}" coming` : ''].filter(Boolean).join(', '));
  }
  if (rider.ski.wants.includes('groomers') && today && today.windMax <= 15 && (today.snowfall ?? 0) === 0) {
    score += 10;
    reasons.push(`Calm and dry today (${today.windMax} mph wind)`);
  }
  if (rider.ski.wants.includes('park')) {
    if (resort.terrainParks) { score += 10; reasons.push('Has terrain parks'); }
    else if (resort.terrainParks === false) { score -= 10; reasons.push('No terrain park'); }
  }
  if (rider.ski.wants.includes('steeps') && t?.advanced >= 40) {
    score += 10;
    reasons.push(`${t.advanced}% advanced terrain`);
  }

  // Closer is a little better
  if (rider.home) {
    score += closePoints(rider, resort);
    reasons.push(`${distanceMi(rider.home, resort)} mi away`);
  }
  return { score, reasons: [...new Set(reasons)], blockers };
}

// Is this beach ruled out for you? Returns the reasons (empty = it's fine).
export function surfBlockers(spot, rider, { checkDistance = true } = {}) {
  const out = [];
  const water = ok(spot.buoy) && spot.buoy.data.waterTempF != null ? spot.buoy.data.waterTempF
    : ok(spot.waves) ? spot.waves.data.seaSurfaceTempF : null;
  if (rider.surf.minWaterF && water != null && water < rider.surf.minWaterF) {
    out.push(`Water ${Math.round(water)}°F, colder than your ${rider.surf.minWaterF}°F`);
  }
  const far = checkDistance && tooFar(rider, spot);
  if (far) out.push(`${far} mi away (farther than ${rider.radiusMi} mi)`);
  return out;
}

export function surfFit(spot, rider, profile, skills) {
  const blockers = surfBlockers(spot, rider);
  const reasons = [];
  let score = (spot.rating.score ?? 1) * 10;
  if (hasProfile(profile)) {
    const f = fitToday(spot, profile, skills);
    if (f.fits) { score += 20; reasons.push('Fits your level and board today'); }
    else if (f.fits === false) blockers.push(f.reasons[0]);
  }
  if (ok(spot.waves)) reasons.push(`${spot.waves.data.heightFt} ft @ ${spot.waves.data.periodS} s`);
  if (rider.home) {
    score += closePoints(rider, spot);
    reasons.push(`${distanceMi(rider.home, spot)} mi away`);
  }
  return { score, reasons, blockers };
}

// Your top picks: { picks: [{ item, score, reasons }], farther: [...] }
//   picks:   the best places that aren't ruled out
//   farther: up to 2 places a bit past your travel distance (up to 1.5×) that
//            would have made your list, so a great mountain just out of range
//            isn't silently hidden
export function recommend(kind, report, rider, profile, count = 3) {
  const scored = report.sections[kind].items
    .map((item) => ({ item, ...(kind === 'snow' ? skiFit(item, rider) : surfFit(item, rider, profile, report.sections.surf.skills)) }))
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
  const picks = scored.filter((x) => !x.blockers.length).slice(0, count);
  const cutoff = picks.length < count ? -Infinity : picks.at(-1).score;
  const farther = !rider.home || !rider.radiusMi ? [] : scored.filter((x) => {
    const onlyTooFar = x.blockers.length === 1 && x.blockers[0].includes(' mi away');
    return onlyTooFar && distanceMi(rider.home, x.item) <= rider.radiusMi * 1.5 && x.score > cutoff;
  }).slice(0, 2);
  return { picks, farther };
}
