// What to wear: a wetsuit for the water temperature, sun protection for the UV
// index, and ski layers for how cold it feels on the hill. Plain rules of thumb
// (no page, no storage), so the email script could use them too.

// ---------- Surf ----------

// Common wetsuit chart (water temperature in °F). "4/3" means 4 mm thick on the
// body and 3 mm on the arms and legs.
const WETSUITS = [
  [75, 'Boardshorts or swimsuit', 'A rash guard for sun and wax rash'],
  [70, 'Rash guard or 2 mm top', 'Or a thin spring suit if you get cold'],
  [65, 'Spring suit (2 mm)', 'Short arms and legs; a 3/2 full suit on windy days'],
  [61, '3/2 full suit', 'Full arms and legs'],
  [57, '3/2 or 4/3 full suit', '4/3 if you run cold or the wind is up'],
  [53, '4/3 full suit', 'Booties optional'],
  [48, '4/3 or 5/4 full suit + booties', 'Gloves and a hood on windy days'],
  [42, '5/4 hooded suit, booties, gloves', '5–7 mm booties and gloves'],
  [-Infinity, '6/5 hooded suit, 7 mm booties, mittens', 'Very cold water: keep sessions short'],
];

// { suit, note } for a water temperature, or null if unknown. Cold, windy air
// (it's hard to warm up between waves) bumps you one step warmer.
export function wetsuitFor(waterF, { airF = null, windMph = null } = {}) {
  if (waterF == null) return null;
  let i = WETSUITS.findIndex(([min]) => waterF >= min);
  const chilly = (airF != null && airF < 55) || (windMph != null && windMph >= 15);
  if (chilly && i < WETSUITS.length - 1) i++;
  const [, suit, note] = WETSUITS[i];
  return { suit, note: chilly ? `${note}. Cold or windy air today, so one step warmer.` : note };
}

// UV index levels (US EPA / WHO scale)
export function uvAdvice(uv) {
  if (uv == null) return null;
  const n = Math.round(uv);
  if (n <= 2) return { level: 'Low', note: 'Sunscreen if you’re out for hours' };
  if (n <= 5) return { level: 'Moderate', note: 'Water-resistant SPF 30+ sunscreen' };
  if (n <= 7) return { level: 'High', note: 'SPF 30+, reapply every 2 hours; a rash guard helps' };
  if (n <= 10) return { level: 'Very high', note: 'SPF 50, rash guard and surf hat; avoid 10 AM–4 PM' };
  return { level: 'Extreme', note: 'SPF 50, cover up, and surf early or late' };
}

// ---------- Snow ----------

// Layers for how cold it FEELS (wind chill) between 9 AM and 4 PM.
// { feels, layers: [base, mid, outer, extras], warning }
const LAYERS = [
  [45, ['Light base layer or T-shirt', 'No mid layer', 'Light shell or vest', 'Sunglasses, sunscreen, light gloves']],
  [32, ['Lightweight base layer', 'Light fleece', 'Shell jacket', 'Gloves, thin beanie or helmet liner']],
  [20, ['Midweight base layer', 'Fleece or light insulated jacket', 'Shell jacket', 'Warm gloves, neck gaiter']],
  [10, ['Heavyweight base layer', 'Insulated (puffy) mid layer', 'Shell jacket', 'Mittens, balaclava, goggles']],
  [0, ['Heavyweight base layer', 'Two mid layers (fleece + puffy)', 'Insulated jacket', 'Mittens, hand warmers, face mask']],
  [-Infinity, ['Expedition-weight base layer', 'Fleece + heavy puffy', 'Insulated jacket and pants', 'Face mask, hand and toe warmers']],
];

export function layersFor(day) {
  if (!day) return null;
  // Prefer "feels like" on the slopes; fall back to the day's low and high
  const low = day.feelsLow ?? day.tempLow;
  const high = day.feelsHigh ?? day.tempHigh;
  if (low == null) return null;
  const [, [base, mid, outer, extras]] = LAYERS.find(([min]) => low >= min);
  const notes = [];
  if (day.snowfall > 0) notes.push('Snowing: waterproof shell and pants, low-light goggle lens');
  if (day.windMax >= 25) notes.push(`Windy (${day.windMax} mph): cover your face and neck`);
  const warning = low < -10 ? 'Frostbite can set in within 30 minutes on bare skin. Cover everything.' : null;
  return { low, high, feelsLike: day.feelsLow != null, layers: { base, mid, outer, extras }, notes, warning };
}
