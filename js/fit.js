// "Does this surf fit you?" — pure rules, no page or browser storage involved, so
// the same code runs in the browser (Surf tab, Notifications) and in Node (the
// morning email script). The thresholds (skills) come from config/ratings.json ->
// surf.skills, copied into the report by the fetch script.
//
// profile = { levels: ['intermediate', ...], boards: ['longboard', ...] }
// A day fits when it suits at least one picked level with at least one picked board.

const LEVEL_ORDER = ['beginner', 'intermediate', 'advanced', 'pro'];

export const hasProfile = (profile) => Boolean(profile?.levels?.length || profile?.boards?.length);

// "intermediate or advanced surfer on a longboard or shortboard"
export function profileText(profile, skills) {
  const list = (keys, table) => keys.map((k) => table[k]?.label.toLowerCase()).filter(Boolean).join(' or ');
  const lv = list(profile.levels, skills.levels);
  const bd = list(profile.boards, skills.boards);
  return `${lv ? `${lv} ` : ''}surfer${bd ? ` on a ${bd}` : ''}`;
}

// One level + one board (either may be null): the reasons this day DOESN'T fit.
function problems(spot, day, wind, levelKey, boardKey, skills) {
  const level = levelKey ? skills.levels[levelKey] : null;
  const board = boardKey ? skills.boards[boardKey] : null;
  const reasons = [];
  // Some beaches aren't for every level, whatever the waves are doing
  if (levelKey && spot.minLevel && LEVEL_ORDER.indexOf(levelKey) < LEVEL_ORDER.indexOf(spot.minLevel)) {
    reasons.push(`Best for ${skills.levels[spot.minLevel].label.toLowerCase()} surfers and up${spot.minLevelNote ? ` (${spot.minLevelNote.toLowerCase()})` : ''}`);
  }
  // Wave height must suit both the level and the board
  for (const [rule, name] of [[level, level && `${level.label.toLowerCase()} surfers`], [board, board && `a ${board.label.toLowerCase()}`]]) {
    if (!rule) continue;
    if (day.ft < rule.minFt) reasons.push(`Too small for ${name} (needs ${rule.minFt}+ ft)`);
    else if (day.ft > rule.maxFt) reasons.push(`Too big for ${name} (up to ${rule.maxFt} ft)`);
  }
  // Short-period waves are weak and choppy: no good for a shortboard or gun
  if (board?.minPeriodS && day.s != null && day.s < board.minPeriodS) {
    reasons.push(`Period too short for a ${board.label.toLowerCase()} (needs ${board.minPeriodS}+ s)`);
  }
  // Strong wind makes it messy, unless it's offshore (blowing from land to sea)
  if (level && wind?.mph != null && wind.mph > level.maxWindMph && wind.relative !== 'offshore') {
    reasons.push(`Too windy for ${level.label.toLowerCase()} surfers (${wind.mph} mph ${wind.relative})`);
  }
  return reasons;
}

// One day at one beach: { fits: true|false|null, reasons }. Tries every picked level
// with every picked board; any match = fits. Otherwise reasons from the closest match.
export function fitDay(spot, day, wind, profile, skills) {
  if (!skills || !hasProfile(profile) || day?.ft == null) return { fits: null, reasons: [] };
  const lv = profile.levels.length ? profile.levels : [null];
  const bd = profile.boards.length ? profile.boards : [null];
  let closest = null;
  for (const l of lv) {
    for (const b of bd) {
      const reasons = problems(spot, day, wind, l, b, skills);
      if (!reasons.length) {
        const who = [l && skills.levels[l].label.toLowerCase(), b && `on a ${skills.boards[b].label.toLowerCase()}`].filter(Boolean).join(' ');
        return { fits: true, reasons: [`${day.ft} ft @ ${day.s ?? '?'} s suits ${who}`] };
      }
      if (!closest || reasons.length < closest.length) closest = reasons;
    }
  }
  return { fits: false, reasons: closest };
}

// Today's conditions at a beach (the forecast for the session hour)
export function fitToday(spot, profile, skills) {
  const w = spot.waves?.status === 'ok' ? spot.waves.data : null;
  const wind = spot.wind?.status === 'ok' ? { mph: spot.wind.data.speedMph, relative: spot.wind.data.relative } : null;
  return fitDay(spot, w && { ft: w.heightFt, s: w.periodS }, wind, profile, skills);
}

// Each of the next few days: [{ date, ft, s, wind, fits, reasons }]
export function fitDays(spot, profile, skills) {
  if (spot.waves?.status !== 'ok') return [];
  const winds = Object.fromEntries((spot.wind?.status === 'ok' ? spot.wind.data.days ?? [] : []).map((d) => [d.date, d]));
  return (spot.waves.data.days ?? []).map((d) => {
    const wind = winds[d.date] ?? null;
    return { ...d, wind, ...fitDay(spot, d, wind, profile, skills) };
  });
}
