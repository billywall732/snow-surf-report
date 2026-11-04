// The first-visit walkthrough: welcome, a few questions, notifications, done.
//
// It runs once, for someone new: if this browser already has a profile, pins or alert
// settings saved, it never shows (and is marked done). Skip on any step ends it; More →
// Replay walkthrough runs it again. Every answer is saved the moment you pick it, into
// the same fields the Profile and Notifications pages use (no Save button), and nothing
// you already had is cleared. Email alerts need Google sign-in: the walkthrough says so
// and offers it, but never requires it.
import { h } from './ui.js';
import { CITIES } from './cities.js';
import { RIDE_TYPES, SKI_LEVELS } from './recommend.js';
import { boards, levels, loadProfile, saveProfile } from './skill.js';
import { goToPage, loadRider, saveRider } from './rider.js';
import { alertSettings, updateAlertSettings } from './alerts.js';
import { account, isConfigured, onAccountChange, signIn } from './account.js';

const KEY = 'ssr-welcome'; // 'done' or 'skipped'
const STEPS = 4;
// Saved before this page changed anything (app.js saves the open tab as soon as it starts)
const KEEP = ['ssr-theme', 'ssr-motion', 'ssr-intro-seen', 'ssr-tab', KEY];
const hadData = (() => {
  try { return Object.keys(localStorage).some((k) => k.startsWith('ssr-') && !KEEP.includes(k)); } catch { return true; }
})();
const seen = () => { try { return Boolean(localStorage.getItem(KEY)); } catch { return true; } };
const mark = (v) => { try { localStorage.setItem(KEY, v); } catch { /* private mode */ } };

let dialog = null;
let step = 1;
// Signing in from step 3 redraws it (one listener for the whole visit; it does nothing when closed)
onAccountChange(() => { if (dialog && step === 3) draw(); });

// Called once the page is drawn. New visitors get the walkthrough after the intro screen.
export function maybeStartWalkthrough() {
  wireReplay();
  if (seen()) return;
  if (hadData) { mark('done'); return; } // returning visitor from before the walkthrough existed
  if (location.hash.includes('/')) return; // a link straight to a place (e.g. from an email): next time
  const go = () => openWalkthrough();
  if (document.documentElement.classList.contains('intro-open')) {
    const watch = new MutationObserver(() => {
      if (!document.documentElement.classList.contains('intro-open')) { watch.disconnect(); setTimeout(go, 300); }
    });
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  } else go();
}

function wireReplay() {
  const b = document.getElementById('replay-walkthrough');
  if (!b || b.dataset.wired) return;
  b.dataset.wired = '1';
  b.addEventListener('click', () => {
    document.getElementById('more-menu').hidden = true;
    document.getElementById('more-button').setAttribute('aria-expanded', 'false');
    openWalkthrough();
  });
}

export function openWalkthrough() {
  if (dialog?.open) return;
  step = 1;
  dialog = h('dialog', { class: 'detail walkthrough', 'aria-labelledby': 'walk-title' });
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); skip(); }); // Esc = Skip
  document.body.append(dialog);
  draw();
  dialog.showModal();
  focusTitle(); // start screen readers at the step title, not on Skip
}

function close() {
  dialog?.close();
  dialog?.remove();
  dialog = null;
}
function skip() { mark(seen() ? localStorage.getItem(KEY) : 'skipped'); close(); }
function finish() {
  mark('done');
  const here = wantsOf(alertSettings());
  close();
  goToPage(here === 'surf' ? 'surf' : 'snow');
}

// ---------- What's saved (read back from the same places the app uses) ----------

// 'snow', 'surf' or 'both', from which alerts are on
const wantsOf = (s) => (s.snowOn && !s.surfOn ? 'snow' : s.surfOn && !s.snowOn ? 'surf' : 'both');
let wants = null; // this run's answer to "what are you here for?" (null = not answered yet)

function setWants(v) {
  wants = v;
  updateAlertSettings({ snowOn: v !== 'surf', surfOn: v !== 'snow' });
  draw();
}
function setRider(fn) { const r = loadRider(); saveRider(fn(r)); draw(); }
function setSurfer(fn) { saveProfile(fn(loadProfile())); draw(); }
const toggleIn = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

// ---------- Building blocks ----------

function chipGroup(title, entries, isOn, onPick, note) {
  return h('div', { class: 'chip-row', role: 'group', 'aria-label': title },
    h('span', { class: 'chip-row-label' }, title, note ? h('span', { class: 'fine' }, ` (${note})`) : null),
    h('div', { class: 'chips' }, entries.map(([value, label, hint]) => {
      const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(isOn(value)) }, label, hint ? h('span', { class: 'chip-note' }, hint) : null);
      b.addEventListener('click', () => onPick(value));
      return b;
    })));
}
function selectBox(label, options, value, onChange) {
  const sel = h('select', {}, options.map(([v, l]) => {
    const o = h('option', { value: String(v) }, l);
    if (String(v) === String(value)) o.selected = true;
    return o;
  }));
  sel.addEventListener('change', () => onChange(sel.value));
  return h('label', { class: 'control' }, h('span', {}, label), sel);
}
function btn(text, onClick, cls = 'action-button') {
  const b = h('button', { type: 'button', class: cls }, text);
  b.addEventListener('click', onClick);
  return b;
}

// ---------- The steps ----------

function draw() {
  if (!dialog) return;
  const focusAfter = dialog.querySelector(':focus')?.textContent;
  const body = [welcomeStep, questionsStep, notifyStep, doneStep][step - 1]();
  const titles = ['Welcome', 'A few quick questions', 'How you’ll hear about it', 'You’re all set'];
  dialog.replaceChildren(
    h('div', { class: 'walk-head' },
      h('div', { class: 'walk-progress', 'aria-hidden': 'true' }, Array.from({ length: STEPS }, (_, i) => h('span', { class: i < step ? 'on' : '' }))),
      h('p', { class: 'walk-step' }, `Step ${step} of ${STEPS}`),
      h('h2', { id: 'walk-title' }, titles[step - 1]),
      btn('Skip', skip, 'text-button walk-skip')),
    h('div', { class: 'walk-body' }, body),
    h('div', { class: 'walk-foot' },
      step > 1 ? btn('Back', () => { step -= 1; draw(); focusTitle(); }, 'text-button') : h('span'),
      step < STEPS
        ? btn(step === 1 ? 'Let’s set it up' : 'Next', () => { step += 1; draw(); focusTitle(); })
        : btn(`Show me the ${wantsOf(alertSettings()) === 'surf' ? 'surf' : 'snow'}`, finish)));
  // Keep keyboard focus on the button you just pressed when the step redraws
  const again = focusAfter && [...dialog.querySelectorAll('button')].find((b) => b.textContent === focusAfter);
  if (again) again.focus();
}
function focusTitle() {
  const t = dialog?.querySelector('#walk-title');
  if (t) { t.tabIndex = -1; t.focus(); }
}

function welcomeStep() {
  return [
    h('p', { class: 'walk-lede' }, 'Snow & Surf Report rates ski mountains and surf spots every morning from the latest forecasts, and tells you when conditions match what you like.'),
    h('ul', { class: 'walk-points' },
      h('li', {}, h('span', { 'aria-hidden': 'true' }, '❄️ '), 'Mountains rated for fresh snow, base, wind and temperature'),
      h('li', {}, h('span', { 'aria-hidden': 'true' }, '🏄 '), 'Surf spots rated for waves, wind and tides, and for your level and board'),
      h('li', {}, h('span', { 'aria-hidden': 'true' }, '🔔 '), 'Alerts on this device or by email when your spots look good')),
    h('p', { class: 'fine' }, 'Two minutes to set up. Skip any time; everything can be changed later under Profile and Notifications.'),
  ];
}

function questionsStep() {
  const s = alertSettings();
  const here = wants ?? wantsOf(s);
  const rider = loadRider();
  const surfer = loadProfile();
  const snow = here !== 'surf', surf = here !== 'snow';
  const cityNow = rider.home && CITIES.some(([n]) => n === rider.home.label) ? rider.home.label : '';
  const nearby = s.snowScope === 'nearby' || s.surfScope === 'nearby';
  return [
    chipGroup('What are you here for?', [['snow', '❄️ Snow'], ['surf', '🏄 Surf'], ['both', 'Both']], (v) => v === here, setWants),
    snow ? h('fieldset', { class: 'walk-set' }, h('legend', {}, '❄️ On the mountain'),
      chipGroup('How do you ride?', RIDE_TYPES, (v) => rider.ski.ride.includes(v), (v) => setRider((r) => ({ ...r, ski: { ...r.ski, ride: toggleIn(r.ski.ride, v) } })), 'pick one or both'),
      chipGroup('Your level', SKI_LEVELS, (v) => rider.ski.levels.includes(v), (v) => setRider((r) => ({ ...r, ski: { ...r.ski, levels: toggleIn(r.ski.levels, v) } })))) : null,
    surf ? h('fieldset', { class: 'walk-set' }, h('legend', {}, '🏄 In the water'),
      chipGroup('Your surfing level', levels().map(([k, v]) => [k, v.label]), (v) => surfer.levels.includes(v), (v) => setSurfer((p) => ({ ...p, levels: toggleIn(p.levels, v) }))),
      chipGroup('Your board', boards().map(([k, v]) => [k, v.label]), (v) => surfer.boards.includes(v), (v) => setSurfer((p) => ({ ...p, boards: toggleIn(p.boards, v) })), 'pick any you ride')) : null,
    h('fieldset', { class: 'walk-set' }, h('legend', {}, '📍 Where you ride from'),
      h('div', { class: 'list-controls' },
        selectBox('Home city', [['', rider.home && !cityNow ? `(${rider.home.label})` : 'Choose a city'], ...CITIES.map(([n]) => [n, n])], cityNow, (v) => {
          const c = CITIES.find(([n]) => n === v);
          if (c) setRider((r) => ({ ...r, home: { label: c[0], lat: c[1], lon: c[2] } }));
        }),
        selectBox('How far you’ll travel', [[50, '50 miles'], [100, '100 miles'], [200, '200 miles'], [300, '300 miles'], [500, '500 miles'], [1000, '1,000 miles'], ['', 'Any distance']],
          rider.radiusMi ?? '', (v) => setRider((r) => ({ ...r, radiusMi: Number(v) || null })))),
      rider.home ? h('label', { class: 'switch-row' }, (() => {
        const box = h('input', { type: 'checkbox' });
        box.checked = nearby;
        box.addEventListener('change', () => {
          const scope = box.checked ? 'nearby' : 'pinned';
          updateAlertSettings({ snowScope: scope, surfScope: scope });
          draw();
        });
        return box;
      })(), h('span', {}, 'Alert me about places within that distance')) : h('p', { class: 'fine' }, 'Pick a city to get picks and alerts near you. Or skip it and pin your favorite spots with ☆ later.')),
    h('p', { class: 'fine' }, 'Saved as you go, on this device (and to your account if you sign in).'),
  ];
}

function notifyStep() {
  const s = alertSettings();
  const deviceOn = s.deviceOn && 'Notification' in window && Notification.permission === 'granted';
  const canDevice = 'Notification' in window;
  const deviceButton = btn(deviceOn ? 'On for this device' : 'Turn on for this device', () => {
    // The same switch as on the Notifications page (it asks the browser for permission)
    const box = document.getElementById('alerts-device');
    if (!box || box.checked) return;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    setTimeout(draw, 1500);
  });
  if (deviceOn) deviceButton.disabled = true;
  const signedIn = Boolean(account.user);
  return [
    h('p', { class: 'walk-lede' }, 'Two ways to hear about it. Both are optional, and you can turn them on later on the Notifications tab.'),
    h('section', { class: 'walk-card' },
      h('h3', {}, h('span', { 'aria-hidden': 'true' }, '📱 '), 'Notifications on this device'),
      h('p', {}, 'A notification when something new matches your alerts each time you open the app. No sign-in needed.'),
      canDevice ? deviceButton : h('p', { class: 'fine warn' }, /iPhone|iPad/.test(navigator.userAgent)
        ? 'On iPhone, notifications work in the Home Screen app: tap Share → Add to Home Screen, open it from there, then turn them on.'
        : 'This browser can’t show notifications.')),
    h('section', { class: 'walk-card' },
      h('h3', {}, h('span', { 'aria-hidden': 'true' }, '✉️ '), 'Email alerts'),
      h('p', {}, 'A morning email when your mountains or beaches match, even when the app is closed. ', h('b', {}, 'Email alerts need you to sign in with Google'), ' (we only use your name and email address, never your Gmail).'),
      signedIn
        ? h('p', { class: 'fine' }, `Signed in as ${account.user.email}. Email alerts are set up on the Notifications tab.`)
        : isConfigured ? [btn(account.busy ? 'Signing in…' : 'Sign in with Google', () => signIn(), 'action-button google'), account.error ? h('p', { class: 'fine warn', role: 'status' }, account.error) : null] : null,
      h('p', { class: 'fine' }, 'Not now? Carry on: you can finish setting up and add email alerts any time.')),
  ];
}

function doneStep() {
  const s = alertSettings(), rider = loadRider(), surfer = loadProfile();
  const here = wantsOf(s);
  const label = (list, all) => list.map((k) => (all.find(([v]) => v === k) ?? [k, k])[1]).join(', ');
  const lines = [
    ['Here for', here === 'both' ? 'Snow and surf' : here === 'snow' ? 'Snow' : 'Surf'],
    here !== 'surf' ? ['On the mountain', [label(rider.ski.ride, RIDE_TYPES), label(rider.ski.levels, SKI_LEVELS)].filter(Boolean).join(' · ') || 'Not set'] : null,
    here !== 'snow' ? ['In the water', [label(surfer.levels, levels().map(([k, v]) => [k, v.label])), label(surfer.boards, boards().map(([k, v]) => [k, v.label]))].filter(Boolean).join(' · ') || 'Not set'] : null,
    ['Home', rider.home ? `${rider.home.label}${rider.radiusMi ? `, within ${rider.radiusMi} miles` : ''}` : 'Not set'],
    ['Alerts', [s.snowOn ? 'snow' : null, s.surfOn ? 'surf' : null].filter(Boolean).join(' and ') + (s.snowScope === 'nearby' || s.surfScope === 'nearby' ? ', for places near home' : ', for spots you pin with ☆')],
    ['Notifications', [s.deviceOn ? 'this device' : null, account.user ? 'email (signed in)' : null].filter(Boolean).join(' and ') || 'None yet (Notifications tab)'],
  ].filter(Boolean);
  return [
    h('p', { class: 'walk-lede' }, 'Here’s what’s set. It’s already saved; change anything on the Profile and Notifications tabs.'),
    h('dl', { class: 'walk-summary' }, lines.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    h('p', { class: 'fine' }, 'Replay this walkthrough any time from More → Replay walkthrough.'),
  ];
}
