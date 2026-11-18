// Your Rider Profile: how you ski or ride, how you surf, and where you're coming
// from. It feeds "Recommended for you" on the Snow and Surf tabs, the "For you"
// notes in each detail view, and your alerts. The scoring rules live in
// recommend.js (shared with the morning email script); this file is the page and
// the saving.
//
// Saved in this browser, and to your account when you're signed in (alerts.js
// handles the account part, the same way as your alert settings).
import { ratingBar } from './charts.js';
import { h, scoreLabel, state, bestBetCard as globalBestBetCard } from './ui.js';
import { CITIES } from './cities.js';
import {
  distanceMi, EMPTY_RIDER, hasSkiRider, normalizeRider, recommend, RIDE_TYPES, SKI_LEVELS, SKI_WANTS, skiText,
  TRAVEL_MILES, travelLimit, withinTravelRange,
} from './recommend.js';
import { hasProfile, loadProfile, onProfileChange, profileChips, profileText } from './skill.js';
import { onAccountChange } from './account.js';
import { signInCard } from './signin.js';

const RIDER_KEY = 'ssr-rider';
const listeners = new Set();

export function loadRider() {
  try {
    return normalizeRider(JSON.parse(localStorage.getItem(RIDER_KEY)) ?? EMPTY_RIDER);
  } catch {
    return normalizeRider(EMPTY_RIDER);
  }
}

export function saveRider(rider) {
  const saved = normalizeRider(rider);
  try { localStorage.setItem(RIDER_KEY, JSON.stringify(saved)); } catch { /* private mode */ }
  for (const fn of listeners) fn(saved);
}

// Tell me when the profile changes. Returns a function that stops listening.
export function onRiderChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Switching pages lives in app.js; it hands us the function so buttons here can
// say "go to the Profile page".
let navigate = () => {};
export const setNavigate = (fn) => { navigate = fn; };
export const openProfile = () => navigate('profile');
export const goToPage = (name) => navigate(name); // e.g. 'snow' or 'surf' (the walkthrough's last step)

const place = (item) => (item.city ? `${item.city}, ${item.region}` : item.region);

// ---------- Recommended for you (Snow and Surf tabs) ----------

const surfSetUp = (rider) => hasProfile() || Boolean(rider.home || rider.surf.minWaterF);

// "200 mi"
const travelText = (rider, kind) => `${travelLimit(rider, kind)?.toLocaleString('en-US')} mi`;

function homeText(rider, kind) {
  if (!rider.home) return '';
  return travelLimit(rider, kind) == null ? `anywhere from ${rider.home.label}` : `within ${travelText(rider, kind)} of ${rider.home.label}`;
}

// The "How far you'll travel for snow/surf" setting, saved to rider.travelMi[kind].
// Shared with the first-visit walkthrough.
export function travelSelect(kind, label, makeControl) {
  return makeControl(`rider-${kind}-travel`, label, TRAVEL_MILES, travelLimit(loadRider(), kind),
    (v) => { const r = loadRider(); saveRider({ ...r, travelMi: { ...r.travelMi, [kind]: v === '' ? null : Number(v) } }); });
}

// One recommended place: name, today's rating, where, and why it's a match
function recItem({ item, reasons }, openDetail) {
  const b = h('button', { type: 'button', class: 'rec-item' },
    h('span', { class: 'rec-name' }, item.name, h('span', { class: 'rec-score' }, ` · today ${item.rating.score ?? '–'}/5`)),
    h('span', { class: 'rec-where' }, place(item)),
    h('span', { class: 'rec-why' }, reasons.filter(Boolean).slice(0, 4).map((r) => h('span', { class: 'rec-reason' }, r))));
  b.addEventListener('click', () => openDetail(item.id));
  return h('li', {}, b);
}

function picksList(kind, openDetail, count = 3) {
  const rider = loadRider();
  const { picks } = recommend(kind, state.report, rider, loadProfile(), count);
  const many = kind === 'snow' ? 'mountains' : 'beaches';
  // (One element, not a list of them: replaceChildren() would print a list as text)
  return h('div', { class: 'rec-picks' },
    picks.length
      ? h('ol', { class: 'rec-list' }, picks.map((p) => recItem(p, openDetail)))
      : h('p', { class: 'empty' }, rider.home
        ? `No ${many} ${homeText(rider, kind)} fit your profile today.`
        : `No ${many} fit your profile today.`));
}

export function inRangeBestBetCard(kind, onDetails) {
  const slot = h('div', { class: 'best-bet-slot' });
  const draw = () => {
    const rider = loadRider();
    const section = state.report.sections[kind];
    if (travelLimit(rider, kind) == null) {
      slot.replaceChildren(globalBestBetCard(section, kind, onDetails));
      return;
    }

    const { picks } = recommend(kind, state.report, rider, loadProfile(), 1);
    const pick = picks[0];
    if (!pick) {
      const many = kind === 'snow' ? 'mountains' : 'beaches';
      const inRange = section.items.some((item) => withinTravelRange(item, rider, kind));
      const message = inRange
        ? `No ${many} within your ${travelText(rider, kind)} range fit your profile today.`
        : `No ${many} are within your ${travelText(rider, kind)} range today.`;
      slot.replaceChildren(h('section', { class: 'best-bet' },
        h('span', { class: 'kicker' }, `Best bet for ${kind}`),
        h('p', { class: 'fine' }, message)));
      return;
    }
    const { item } = pick;
    const score = item.rating.score;
    const note = score != null && score < 3 ? `Best within your ${travelText(rider, kind)} range` : `Best bet for ${kind}`;
    const card = h('button', { type: 'button', class: 'best-bet', 'aria-label': `${note}: ${item.name}, ${score ?? 'not rated'} of 5. ${item.rating.reason}. Open details.` },
      h('span', { class: 'kicker' }, note),
      h('span', { class: 'best-bet-name' }, item.name),
      h('span', { class: 'tile-rating' }, ratingBar(score), scoreLabel(item)),
      h('span', { class: 'best-bet-reason' }, `${place(item)} · ${item.rating.reason}`),
      h('span', { class: 'tile-more', 'aria-hidden': 'true' }, 'Details →'));
    card.addEventListener('click', () => onDetails?.(item.id));
    slot.replaceChildren(card);
  };
  draw();
  onRiderChange(draw);
  if (kind === 'surf') onProfileChange(draw);
  return slot;
}

// What's inside the "Recommended … For You" pill once it's open
function recsBody(kind, openDetail) {
  const rider = loadRider();
  const setUp = kind === 'snow' ? hasSkiRider(rider) || Boolean(rider.home) : surfSetUp(rider);
  const edit = h('button', { type: 'button', class: 'text-button' }, setUp ? 'Edit my Rider Profile' : 'Set up my profile →');
  edit.addEventListener('click', openProfile);
  if (!setUp) {
    return [h('p', { class: 'recs-setup' }, kind === 'snow' ? 'Mountain picks made for how you ride.' : 'Beach picks made for how you surf.'), edit];
  }
  const who = kind === 'snow'
    ? skiText(rider)
    : [hasProfile() ? profileText() : '', rider.surf.minWaterF ? `water ${rider.surf.minWaterF}°F+` : ''].filter(Boolean).join(' · ');
  return [h('p', { class: 'fine' }, [who, homeText(rider, kind)].filter(Boolean).join(' · ')), picksList(kind, openDetail), h('div', { class: 'recs-actions' }, edit)];
}

// "Recommended Mountains For You ⌄": a pill like Top 6 that opens to your picks.
// It keeps itself up to date when your profile changes (and stays open or closed).
export function recommendPill(kind, openDetail) {
  const body = h('div', { class: 'recs-body' });
  const pill = h('details', { class: 'pill-details recs-pill', 'aria-labelledby': `${kind}-h-recs` },
    h('summary', { class: 'pill-summary' },
      h('span', { id: `${kind}-h-recs`, class: 'pill-title', role: 'heading', 'aria-level': '2' },
        `Recommended ${kind === 'snow' ? 'Mountains' : 'Beaches'} For You`),
      h('span', { class: 'chevron', 'aria-hidden': 'true' })),
    body);
  const draw = () => body.replaceChildren(...recsBody(kind, openDetail));
  draw();
  onRiderChange(draw);
  if (kind === 'surf') onProfileChange(draw);
  return pill;
}

// ---------- The Profile page ----------

let surfChips; // built once; they keep themselves in sync
let locationMsg = '';
const panel = () => document.getElementById('panel-profile');

// A row of tap-to-pick chips. Tapping one adds or removes it from rider.ski[key].
function chipRow(title, key, entries, note) {
  const rider = loadRider();
  return h('div', { class: 'chip-row', role: 'group', 'aria-label': title },
    h('span', { class: 'chip-row-label' }, title, note ? ` (${note})` : ''),
    h('div', { class: 'chips' }, entries.map(([value, label, hint]) => {
      const on = rider.ski[key].includes(value);
      const b = h('button', { type: 'button', class: 'chip', id: `rider-${key}-${value}`, 'aria-pressed': String(on) },
        label, hint ? h('span', { class: 'chip-note' }, hint) : null);
      b.addEventListener('click', () => {
        const r = loadRider();
        r.ski[key] = r.ski[key].includes(value) ? r.ski[key].filter((v) => v !== value) : [...r.ski[key], value];
        saveRider(r);
      });
      return b;
    })));
}

function select(id, label, options, value, onChange) {
  const sel = h('select', { id }, options.map(([v, text]) => h('option', { value: v == null ? '' : String(v) }, text)));
  sel.value = value == null ? '' : String(value);
  sel.addEventListener('change', () => onChange(sel.value));
  return h('label', { class: 'control' }, h('span', {}, label), sel);
}

// "Use my location": ask the browser, then round to 0.1° (about 7 miles), so we
// never keep your exact spot. The label is the nearest city in our list.
// Shared with the walkthrough: onStatus(message) gets 'Finding you…', an error, or ''
// once your home is saved.
export function locateHome(onStatus) {
  if (!('geolocation' in navigator)) {
    onStatus('This browser can’t share your location. Pick a city instead.');
    return;
  }
  onStatus('Finding you…');
  navigator.geolocation.getCurrentPosition((pos) => {
    const lat = Math.round(pos.coords.latitude * 10) / 10;
    const lon = Math.round(pos.coords.longitude * 10) / 10;
    const [name] = [...CITIES].sort((a, b) => distanceMi({ lat, lon }, { lat: a[1], lon: a[2] }) - distanceMi({ lat, lon }, { lat: b[1], lon: b[2] }))[0];
    saveRider({ ...loadRider(), home: { label: `near ${name}`, lat, lon }, homeExplicit: true });
    onStatus('');
  }, (err) => {
    onStatus(err.code === err.PERMISSION_DENIED
      ? 'Location is blocked for this site. Pick a city instead, or allow location in your browser’s settings.'
      : 'Couldn’t find your location. Pick a city instead.');
  }, { maximumAge: 600_000, timeout: 15_000 });
}
function useMyLocation() { locateHome((msg) => { locationMsg = msg; render(); }); }

function homeCard(rider) {
  const cityOptions = [['', rider.home && !CITIES.some(([n]) => n === rider.home.label) ? `(${rider.home.label})` : 'Choose a city'], ...CITIES.map(([n]) => [n, n])];
  const locate = h('button', { type: 'button', class: 'action-button', id: 'rider-locate' }, '📍 Use my location');
  locate.addEventListener('click', useMyLocation);
  const clear = h('button', { type: 'button', class: 'text-button', id: 'rider-home-clear' }, 'Reset to Pasadena');
  clear.addEventListener('click', () => saveRider({ ...loadRider(), home: EMPTY_RIDER.home, homeExplicit: false }));
  return h('section', { class: 'card alerts-card', 'aria-labelledby': 'h-home' },
    h('h3', { id: 'h-home' }, 'Where you ride from'),
    h('p', {}, rider.home ? ['Home for recommendations: ', h('strong', {}, rider.home.label), rider.homeExplicit ? '' : ' (default)'] : 'Not set yet.'),
    h('div', { class: 'account-actions' }, locate, rider.homeExplicit ? clear : null),
    locationMsg ? h('p', { class: 'fine warn', role: 'status' }, locationMsg) : null,
    h('div', { class: 'list-controls' },
      select('rider-city', 'Or pick a city', cityOptions, rider.home && CITIES.some(([n]) => n === rider.home.label) ? rider.home.label : '', (v) => {
        const c = CITIES.find(([n]) => n === v);
        if (c) saveRider({ ...loadRider(), home: { label: c[0], lat: c[1], lon: c[2] }, homeExplicit: true });
      })),
    h('p', { class: 'fine' }, rider.homeExplicit
      ? 'Your location is rounded to about 7 miles and saved only on this device (and in your account if you sign in). How far you’ll travel is set separately for snow and surf, below.'
      : 'Pasadena is the default home for recommendations. Choose a city or use your location to set a home for nearby alerts.'));
}

function skiCard(rider) {
  const boardOnly = rider.ski.ride.length === 1 && rider.ski.ride[0] === 'snowboard';
  const skiersOnly = state.report.sections.snow.items.filter((r) => r.skiersOnly).map((r) => r.name);
  return h('section', { class: 'card alerts-card', 'aria-labelledby': 'h-ski' },
    h('h3', { id: 'h-ski' }, 'Skiing & snowboarding'),
    h('div', { class: 'skill-chips' },
      chipRow('You ride', 'ride', RIDE_TYPES),
      chipRow('Your level', 'levels', SKI_LEVELS, 'pick all that fit'),
      chipRow('You’re after', 'wants', SKI_WANTS),
      chipRow('Your pass', 'passes', [['Ikon', 'Ikon Pass'], ['Epic', 'Epic Pass']], 'none = any mountain')),
    h('div', { class: 'list-controls' },
      travelSelect('snow', 'How far you’ll travel for snow', select)),
    boardOnly && skiersOnly.length
      ? h('p', { class: 'fine' }, `${skiersOnly.join(' and ')} ${skiersOnly.length === 1 ? 'is' : 'are'} skiers only, so we leave ${skiersOnly.length === 1 ? 'it' : 'them'} out of your picks and alerts.`)
      : null,
    h('p', { class: 'fine' }, 'Terrain mix (how much is green, blue and black) and terrain parks come from each mountain’s Wikipedia page, where listed.'));
}

function surfCard(rider) {
  return h('section', { class: 'card alerts-card', 'aria-labelledby': 'h-surf-profile' },
    h('h3', { id: 'h-surf-profile' }, 'Surfing'),
    h('p', { class: 'fine' }, 'Tap one or more levels and boards. Also used by the filters on the Surf tab and your surf alerts.'),
    (surfChips ??= profileChips()),
    h('div', { class: 'list-controls' },
      travelSelect('surf', 'How far you’ll travel for surf', select),
      select('rider-water', 'Coldest water you’ll surf', [
        ['', 'Any temperature'],
        [50, '50°F (thick wetsuit, boots)'],
        [55, '55°F (4/3 wetsuit)'],
        [60, '60°F (3/2 wetsuit)'],
        [65, '65°F (spring suit)'],
        [70, '70°F (boardshorts)'],
      ], rider.surf.minWaterF ?? '', (v) => saveRider({ ...loadRider(), surf: { minWaterF: Number(v) || null } }))));
}

function picksCard() {
  const rider = loadRider();
  const go = (kind) => (id) => { location.hash = `${kind}/${id}`; };
  return h('section', { class: 'card alerts-card', 'aria-labelledby': 'h-picks' },
    h('h3', { id: 'h-picks' }, 'Recommendations based on your profile'),
    h('p', { class: 'fine' }, 'Ranked by how well each place fits you: its size and terrain for your level, what you’re after, how close it is, and today’s conditions. Tap one for details.'),
    h('h4', {}, 'Mountains'),
    rider.home || hasSkiRider(rider) ? picksList('snow', go('snow'), 5) : h('p', { class: 'fine' }, 'Fill in Skiing & snowboarding or where you ride from.'),
    h('h4', {}, 'Beaches'),
    surfSetUp(loadRider()) ? picksList('surf', go('surf'), 5) : h('p', { class: 'fine' }, 'Fill in Surfing or where you ride from.'));
}

function render() {
  // Redrawing replaces the controls; put keyboard focus back where it was.
  const focusedId = document.activeElement?.closest?.('#panel-profile') ? document.activeElement.id : null;
  const rider = loadRider();
  panel().replaceChildren(
    h('div', { class: 'section-head' },
      h('h2', {}, 'Rider Profile'),
      h('p', { class: 'fine' }, 'How you ride and where you’re coming from. Used for “Recommended for you” on Snow and Surf, the “For you” notes in each detail view, and your alerts.')),
    signInCard() ?? [], // (null would print as "null")
    homeCard(rider),
    skiCard(rider),
    surfCard(rider),
    picksCard());
  // preventScroll: on iPhone, refocusing a field would otherwise scroll the page
  if (focusedId) document.getElementById(focusedId)?.focus({ preventScroll: true });
}

export function renderProfile() {
  render();
  onRiderChange(render);
  onAccountChange(render); // signing in or out changes the card at the top
  // The surf chips update themselves, but "Your picks" depends on them too
  onProfileChange(() => {
    const old = document.querySelector('#panel-profile [aria-labelledby="h-picks"]');
    old?.replaceWith(picksCard());
  });
}
