// The Notifications tab: set up alerts for snow coming to your mountains and
// waves that fit your levels and boards, see what matches right now, and (signed in
// with Google) get a morning email when something matches.
//
// How alerts reach you:
//   - In the app: listed here, with a red badge on the Notifications tab.
//   - On this device: optionally a notification for anything new when you open the
//     app (browsers that support it; on iPhone only after "Add to Home Screen").
//     Signed in, it also gets a morning "push" notification from the GitHub Action,
//     even when the app is closed.
//   - By email: sign in with Google; your settings save to your account and the
//     morning GitHub Action emails you a summary when something matches. You can
//     send it to another address once you confirm it.
// Without signing in, settings are saved in this browser only.
import { h } from './ui.js';
import { computeAlerts, DEFAULT_SETTINGS, LOOK_AHEAD, watching } from './alert-rules.js';
import { hasProfile, loadProfile, onProfileChange, profileText, saveProfile } from './skill.js';
import { loadRider, onRiderChange, openProfile, saveRider } from './rider.js';
import { distanceMi, normalizeRider, withinReach } from './recommend.js';
import { account, confirmEmail, deleteMyData, emailConfirmed, emailTarget, initAccount, isConfigured, onAccountChange, savePushSub, saveSoon, setAlertEmail, setEmailAlerts, signIn, signOut } from './account.js';
import { vapidPublicKey } from './firebase-config.js';

const SETTINGS_KEY = 'ssr-alerts';
const LOCAL_ONLY = { deviceOn: false, seen: [] }; // device notifications: never synced

let report;
let snowTab;
let surfTab;
const panel = () => document.getElementById('panel-alerts');

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...LOCAL_ONLY, ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) };
  } catch {
    return { ...DEFAULT_SETTINGS, ...LOCAL_ONLY };
  }
}
// For the first-visit walkthrough (welcome.js): read and change alert settings the same
// way this page does (saved here, the page redrawn, and saved to your account if signed in)
export const alertSettings = () => loadSettings();
export function updateAlertSettings(changes) { saveSettings({ ...loadSettings(), ...changes }); if (report) refresh(); saveSoon(); }
function saveSettings(settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode */ }
}

const pins = () => ({ snow: snowTab.pinned(), surf: surfTab.pinned() });
const currentAlerts = (settings = loadSettings()) => computeAlerts(report, settings, loadProfile(), pins(), loadRider());

export function renderAlerts(rep, tabs) {
  report = rep;
  snowTab = tabs.snow;
  surfTab = tabs.surf;
  const old = loadSettings();
  for (const kind of ['snow', 'surf']) {
    if (old[`${kind}Scope`] === 'all') {
      old[`${kind}Scope`] = 'chosen';
      old[`${kind}Watch`] = report.sections[kind].items.map((x) => x.id);
    }
  }
  saveSettings(old);
  // Re-check (and save to your account) whenever pins, your levels/boards or your
  // Rider Profile change
  const changedAndSave = () => { refresh(); saveSoon(); };
  snowTab.onPinsChange = changedAndSave;
  surfTab.onPinsChange = changedAndSave;
  onProfileChange(changedAndSave);
  onRiderChange(changedAndSave);
  onAccountChange(() => { syncPush(); refresh(); });

  // A link from a confirmation email: #confirm/<code>
  const confirm = location.hash.match(/^#confirm\/([a-f0-9]{48})$/);
  if (confirm) {
    history.replaceState(null, '', '#alerts');
    document.getElementById('tab-alerts').click();
    confirmMsg = 'Confirming your email address…';
    confirmEmail(confirm[1]).then((ok) => {
      confirmMsg = ok
        ? 'Thanks, your email address is confirmed. Alert emails will start going there within the hour.'
        : 'That confirmation link didn’t work. Check your connection and open it again.';
      refresh();
    });
  }

  initAccount({
    // What gets saved to your account
    getPrefs: () => {
      const { deviceOn, seen, ...settings } = loadSettings();
      return { settings, profile: loadProfile(), pins: pins(), rider: loadRider() };
    },
    // Your account's saved settings -> this device
    applyPrefs: ({ settings, profile, pins: saved, rider }) => {
      if (settings) saveSettings({ ...loadSettings(), ...settings });
      if (profile) saveProfile({ levels: profile.levels ?? [], boards: profile.boards ?? [] });
      if (saved?.snow) snowTab.setPinned(saved.snow);
      if (saved?.surf) surfTab.setPinned(saved.surf);
      if (rider) saveRider(normalizeRider(rider));
      refresh();
    },
  });

  refresh();
  notifyDevice();
}

function refresh() {
  // Re-drawing replaces the controls; put keyboard focus back where it was.
  const focusedId = document.activeElement?.closest?.('#panel-alerts') ? document.activeElement.id : null;
  render();
  updateBadge();
  if (focusedId) document.getElementById(focusedId)?.focus();
}

function updateBadge() {
  const badge = document.getElementById('alerts-badge');
  const n = currentAlerts().length;
  badge.hidden = n === 0;
  badge.textContent = n ? (n > 9 ? '9+' : String(n)) : '';
  document.getElementById('tab-alerts').setAttribute('aria-label', n ? `Notifications, ${n} new` : 'Notifications');
}

// ---------- Device notifications ----------

const canNotify = () => 'Notification' in window;

// The helper script (js/sw.js) that some browsers need to show notifications.
// Registered only once you've turned device notifications on.
let worker = null;
async function getWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    worker ??= await navigator.serviceWorker.register('js/sw.js', { scope: 'js/' });
    return worker;
  } catch {
    return null; // e.g. a private window: fall back to plain notifications
  }
}

// Show one notification. Tapping it opens the place it's about.
async function showNotification(title, body, hash, tag) {
  const reg = await getWorker();
  try {
    if (reg?.showNotification) {
      await reg.showNotification(title, { body, tag, data: { hash } });
      return true;
    }
    const n = new Notification(title, { body, tag });
    n.onclick = () => { window.focus(); location.hash = hash; };
    return true;
  } catch {
    return false; // this browser only allows notifications from an installed app
  }
}

// ---------- Morning push notifications (signed in) ----------
// The GitHub Action sends these through the browser's push service, so they arrive
// even when the app is closed. Each device saves its own "subscription" (an address
// only the push service can use) to your account.

const canPush = () => isConfigured && Boolean(vapidPublicKey) && 'PushManager' in window && 'serviceWorker' in navigator;

function deviceId() {
  let id = null;
  try { id = localStorage.getItem('ssr-device-id'); } catch { /* ignore */ }
  if (!id) {
    id = `d${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    try { localStorage.setItem('ssr-device-id', id); } catch { /* ignore */ }
  }
  return id;
}

// The push service wants the public key as bytes
function keyBytes(base64url) {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const deviceLabel = () => (/iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android' : 'Computer');

async function setPush(on) {
  const reg = await getWorker();
  if (!reg?.pushManager) return false;
  try {
    let sub = await reg.pushManager.getSubscription();
    if (!on) {
      await sub?.unsubscribe();
      return account.user ? savePushSub(deviceId(), null) : true;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidPublicKey) });
    return savePushSub(deviceId(), { ...sub.toJSON(), device: deviceLabel(), at: new Date().toISOString() });
  } catch {
    return false; // e.g. iPhone outside the Home Screen app
  }
}

// After signing in (or loading the page signed in) with device notifications on,
// make sure this device is registered for morning notifications.
let pushSynced = false;
async function syncPush() {
  if (!account.user) { pushSynced = false; return; }
  if (pushSynced || account.busy || !canPush() || !loadSettings().deviceOn || Notification.permission !== 'granted') return;
  pushSynced = true;
  await setPush(true);
}

// Show a device notification for alerts you haven't been notified about yet.
// Runs when the app opens, and right away when you turn notifications on.
async function notifyDevice() {
  const settings = loadSettings();
  if (!settings.deviceOn || !canNotify() || Notification.permission !== 'granted') return 0;
  const fresh = currentAlerts(settings).filter((a) => !settings.seen.includes(a.id));
  for (const a of fresh.slice(0, 3)) await showNotification(a.title, a.detail, a.hash, a.id);
  saveSettings({ ...loadSettings(), seen: [...settings.seen, ...fresh.map((a) => a.id)].slice(-200) });
  return fresh.length;
}

// ---------- The page ----------

function select(id, label, options, value, onChange) {
  const sel = h('select', { id }, options.map(([v, text]) => h('option', { value: v }, text)));
  sel.value = String(value);
  sel.addEventListener('change', () => onChange(sel.value));
  return h('label', { class: 'control' }, h('span', {}, label), sel);
}

function toggle(id, label, checked, onChange) {
  const box = h('input', { type: 'checkbox', id });
  box.checked = checked;
  box.addEventListener('change', () => onChange(box.checked));
  return h('label', { class: 'switch-row', for: id }, box, h('span', {}, label));
}

function button(id, text, onClick, cls = 'action-button') {
  const b = h('button', { type: 'button', id, class: cls }, text);
  b.addEventListener('click', onClick);
  return b;
}

// ---------- Layout ----------
// Three cards, so the page reads top to bottom:
//   1. Today: what matches right now (and, folded away, everything you watch)
//   2. What to alert me about: snow and surf, one line each, with "Change"
//   3. How you'll hear about it: in the app, by email, on this device

const editing = { snow: false, surf: false }; // which "Change" panels are open

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// "your 4 pinned mountains" / "3 mountains you chose" / "mountains within 300 mi of Los Angeles, CA"
function scopeText(kind, settings, rider) {
  const [one, many] = NOUN[kind];
  const scope = settings[`${kind}Scope`];
  if (scope === 'chosen') return plural(settings[`${kind}Watch`].length, `${one} you chose`, `${many} you chose`);
  if (scope === 'nearby') {
    if (!rider.home) return `${many} near you (set your home in your Rider Profile)`;
    return `${many} ${rider.radiusMi ? `within ${rider.radiusMi} mi of` : 'from'} ${rider.home.label}`;
  }
  const n = pins()[kind].length;
  return n ? `your ${plural(n, `pinned ${one}`, `pinned ${many}`)}` : `your pinned ${many} (none yet: pin some on the ${kind === 'snow' ? 'Snow' : 'Surf'} tab)`;
}

// One alert rule: on/off, a one-line summary, and a "Change" panel with the details
function ruleRow(kind, { icon, title, on, onToggle, summary, warn, editor }) {
  const change = button(`edit-${kind}`, editing[kind] ? 'Done' : 'Change', () => { editing[kind] = !editing[kind]; refresh(); }, 'text-button');
  change.setAttribute('aria-expanded', String(editing[kind]));
  change.setAttribute('aria-controls', `editor-${kind}`);
  const panel = h('div', { class: 'rule-editor', id: `editor-${kind}` }, editor);
  panel.hidden = !editing[kind];
  return h('div', { class: on ? 'rule' : 'rule is-off' },
    h('div', { class: 'rule-line' },
      h('span', { class: 'rule-icon', 'aria-hidden': 'true' }, icon),
      toggle(`alerts-${kind}-on`, title, on, onToggle),
      change),
    h('p', { class: warn && on ? 'rule-summary warn' : 'rule-summary' }, on ? summary : 'Off'),
    panel);
}

// Change where alert emails go
let emailEditing = false;
function emailForm(google) {
  const input = h('input', { id: 'email-address', type: 'email', autocomplete: 'email', required: '', value: account.alertEmail || google });
  const form = h('form', { class: 'email-form' },
    h('label', { for: 'email-address' }, 'Send alert emails to'),
    h('div', { class: 'email-row' }, input, h('button', { type: 'submit', class: 'action-button' }, 'Save')),
    account.alertEmail
      ? button('email-google', `Use ${google} instead`, async () => { emailEditing = false; await setAlertEmail(google); }, 'text-button')
      : null,
    h('p', { class: 'fine' }, 'A new address gets a confirmation link first, so nobody can sign up someone else.'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!input.checkValidity()) { input.reportValidity(); return; }
    emailEditing = false;
    await setAlertEmail(input.value);
  });
  return form;
}

// Email: not available yet / sign in / signed in
function emailChannel() {
  const parts = [];
  if (!isConfigured) {
    parts.push(h('p', { class: 'channel-note' }, 'Coming soon: a morning email when something matches.'));
  } else if (!account.user) {
    parts.push(
      h('p', { class: 'channel-note' }, 'A morning email when something matches. Signing in also saves your settings to your account.'),
      button('sign-in', account.busy ? 'Signing in…' : 'Sign in with Google', () => signIn(), 'action-button google'),
      h('p', { class: 'fine' }, 'We only use your name and email address. We never see your Gmail.'));
  } else {
    const google = account.user.email;
    parts.push(
      toggle('email-on', 'Email me a morning summary', account.emailAlerts, (on) => setEmailAlerts(on)),
      h('p', { class: 'channel-note' }, 'Around 5 AM Pacific, only on days something matches. Sending to ',
        h('strong', {}, emailConfirmed() ? emailTarget() : google), '. ',
        button('email-change', emailEditing ? 'Cancel' : 'Change', () => {
          emailEditing = !emailEditing;
          refresh();
          if (emailEditing) document.getElementById('email-address')?.focus();
        }, 'text-button inline-link')),
      emailConfirmed() ? null : h('p', { class: 'fine warn' },
        `Waiting for you to confirm ${account.alertEmail}. Within the hour we’ll email it a link; until you tap it, emails go to ${google}.`),
      emailEditing ? emailForm(google) : null,
      h('p', { class: 'fine' }, 'Signed in as ', h('strong', {}, google), '. Your settings save to your account.'),
      h('div', { class: 'account-actions' },
        button('sign-out', 'Sign out', () => signOut(), 'text-button')));
    // (Deleting saved data is under "Your data", at the bottom of this tab.)
  }
  if (account.busy && account.user) parts.push(h('p', { class: 'fine' }, 'Loading your saved settings…'));
  if (account.error) parts.push(h('p', { class: 'fine warn', role: 'alert' }, account.error));
  return parts;
}

function render() {
  const settings = loadSettings();
  // Change a setting: save on this device, then (if signed in) to your account
  const update = (changes) => { saveSettings({ ...loadSettings(), ...changes }); refresh(); saveSoon(); };
  const alerts = currentAlerts(settings);
  const rider = loadRider();

  // "Near me" needs a home in the Rider Profile
  const nearNote = (scope, extra = '') => {
    if (scope !== 'nearby') return null;
    if (!rider.home) return h('p', { class: 'fine warn' }, 'Set where you ride from in your Rider Profile to use this. ', profileLink());
    const where = rider.radiusMi ? `within ${rider.radiusMi} mi of ` : 'from ';
    return h('p', { class: 'fine' }, `Everywhere ${where}${rider.home.label}${extra}. `, profileLink());
  };
  const cap = (x) => x[0].toUpperCase() + x.slice(1);
  const scopes = (many) => [['pinned', `My pinned ${many}`], ['chosen', `${cap(many)} I choose`], ['nearby', `${cap(many)} near me`]];
  const boardOnly = rider.ski.ride.length === 1 && rider.ski.ride[0] === 'snowboard';
  const passNote = rider.ski.passes.length ? ` on the ${rider.ski.passes.join(' or ')} Pass` : '';
  const article = /^[aeiou]/i.test(profileText()) ? 'an' : 'a';
  const waterNote = rider.surf.minWaterF ? `, in water ${rider.surf.minWaterF}°F or warmer` : '';

  // ---------- 2. The rules ----------
  const snowRule = ruleRow('snow', {
    icon: '⛰',
    title: 'Snow alerts',
    on: settings.snowOn,
    onToggle: (on) => update({ snowOn: on }),
    summary: `${settings.snowInches}"+ of snow in the next ${settings.snowDays ?? 3} days, at ${scopeText('snow', settings, rider)}`,
    editor: [
      h('div', { class: 'list-controls' },
        select('alerts-snow-inches', 'At least', [2, 4, 6, 10, 12].map((n) => [n, `${n}" of snow`]), settings.snowInches, (v) => update({ snowInches: Number(v) })),
        select('alerts-snow-days', 'Look ahead', LOOK_AHEAD.map((n) => [n, `Next ${n} days`]), settings.snowDays ?? 3, (v) => update({ snowDays: Number(v) })),
        select('alerts-snow-scope', 'For', scopes('mountains'), scopeValue(settings.snowScope), (v) => update({ snowScope: v }))),
      nearNote(settings.snowScope, passNote),
      settings.snowScope === 'chosen' ? chooser('snow') : null,
      boardOnly ? h('p', { class: 'fine' }, 'You snowboard, so skiers-only mountains are left out.') : null,
    ],
  });
  const surfRule = ruleRow('surf', {
    icon: '🌊',
    title: 'Surf alerts',
    on: settings.surfOn,
    onToggle: (on) => update({ surfOn: on }),
    warn: !hasProfile(),
    summary: hasProfile()
      ? `Waves that fit you (${profileText()}) in the next ${settings.surfDays ?? 3} days, at ${scopeText('surf', settings, rider)}`
      : ['Pick your level and board to get surf alerts. ', profileLink()],
    editor: [
      h('p', { class: 'fine' }, hasProfile()
        ? `Waves that fit ${article} ${profileText()} (at ${report.sections.surf.sessionHour ?? 7} AM each day)${waterNote}.`
        : 'Your level and board are set in your Rider Profile.'),
      h('div', { class: 'list-controls' },
        select('alerts-surf-days', 'Look ahead', LOOK_AHEAD.map((n) => [n, `Next ${n} days`]), settings.surfDays ?? 3, (v) => update({ surfDays: Number(v) })),
        select('alerts-surf-scope', 'For', scopes('beaches'), scopeValue(settings.surfScope), (v) => update({ surfScope: v }))),
      nearNote(settings.surfScope),
      settings.surfScope === 'chosen' ? chooser('surf') : null,
    ],
  });

  // ---------- 3. This device ----------
  let deviceStatus = deviceMsg;
  if (!canNotify()) {
    deviceStatus = unsupportedText();
  } else if (Notification.permission === 'denied' && !deviceMsg) {
    deviceStatus = 'Blocked for this site. Allow notifications in your browser’s site settings, then try again.';
  } else if (!deviceStatus) {
    if (canPush() && account.user) deviceStatus = 'A morning notification when something matches, even when the app is closed.';
    else if (canPush()) deviceStatus = 'A notification for anything new when you open the app. Sign in above to also get them in the morning when it’s closed.';
    else deviceStatus = 'A notification for anything new each time you open the app.';
  }
  const deviceToggle = toggle('alerts-device', 'Notify me on this device', settings.deviceOn && canNotify() && Notification.permission === 'granted', async (on) => {
    deviceMsg = '';
    deviceWarn = false;
    if (!on) {
      saveSettings({ ...loadSettings(), deviceOn: false });
      deviceMsg = 'Off. You won’t get notifications on this device.';
      refresh();
      if (canPush()) withTimeout(setPush(false), 8000); // stop morning notifications too
      return;
    }
    if (!canNotify()) {
      deviceWarn = true;
      deviceMsg = unsupportedText();
      refresh();
      return;
    }
    // Ask first, straight from the tap (browsers only show the prompt then)
    const permission = await askPermission();
    const granted = permission === 'granted';
    saveSettings({ ...loadSettings(), deviceOn: granted });
    if (!granted) {
      deviceWarn = true;
      deviceMsg = permission === 'denied'
        ? 'Notifications are blocked for this site. To allow them, click the icon at the left of the address bar, set Notifications to Allow, then turn this on again.'
        : 'Your browser didn’t show the permission prompt, or it was closed. Try again; if nothing appears, allow notifications for this site in your browser’s settings (the icon at the left of the address bar).';
      refresh();
      return;
    }
    // Morning notifications when the app is closed (signed in). Never waits forever.
    if (canPush()) withTimeout(setPush(true), 8000);
    if (granted) {
      // Show something right away, so you know it works
      const sent = await notifyDevice();
      if (sent) {
        deviceMsg = `On: we just sent ${plural(Math.min(sent, 3), 'notification', 'notifications')} for what matches now.`;
      } else {
        const shown = await showNotification('Snow and Surf notifications are on', 'You’ll get a notification here when something new matches your alerts.', 'alerts', 'ssr-test');
        deviceMsg = shown ? 'On: we just sent a test notification.' : 'On, but this browser didn’t show the test notification. On a phone, try the Home Screen app.';
      }
    }
    refresh();
  });
  // (Left clickable even where notifications aren't supported, so a tap explains why.)
  const deviceWarnNow = deviceWarn || !canNotify() || (canNotify() && Notification.permission === 'denied');

  const channel = (icon, title, ...body) => h('li', { class: 'channel' },
    h('span', { class: 'rule-icon', 'aria-hidden': 'true' }, icon),
    h('div', { class: 'channel-body' }, h('p', { class: 'channel-title' }, title), body));

  panel().replaceChildren(...[
    h('div', { class: 'section-head' },
      h('h2', {}, 'Notifications'),
      h('p', { class: 'fine' }, 'What matches today, what to watch for, and how you’ll hear about it.')),
    confirmMsg ? h('p', { class: 'card confirm-msg', role: 'status' }, confirmMsg) : null,

    // 1. Your alerts today
    h('section', { class: `card alerts-card today-card${alerts.length ? ' has-alerts' : ''}`, 'aria-labelledby': 'h-today' },
      h('div', { class: 'today-head' },
        h('span', { class: 'today-bell', 'aria-hidden': 'true' }, bellIcon(), alerts.length ? h('span', { class: 'today-bell-count' }, alerts.length > 9 ? '9+' : String(alerts.length)) : null),
        h('div', { class: 'today-title' },
          h('h3', { id: 'h-today' }, alerts.length ? `${plural(alerts.length, 'alert', 'alerts')} for you today` : 'No alerts today'),
          h('p', { class: 'today-sub' }, alerts.length ? sentNote() : 'We check conditions every hour and will flag anything that matches.'))),
      h('div', { id: 'heads-up-list' }, headsUpList(alerts))),

    // 2. What to alert me about
    h('section', { class: 'card alerts-card', 'aria-labelledby': 'h-rules' },
      h('h3', { id: 'h-rules' }, 'What to alert me about'),
      h('div', { class: 'rules' }, snowRule, surfRule)),

    // 3. How you'll hear about it
    h('section', { class: 'card alerts-card', 'aria-labelledby': 'h-channels' },
      h('h3', { id: 'h-channels' }, 'How you’ll hear about it'),
      h('ul', { class: 'channels' },
        channel('●', 'In the app', h('p', { class: 'channel-note' }, 'Always on. Matches show under Today, with a count on the Notifications tab.')),
        channel('✉', 'Email', emailChannel()),
        channel('▣', 'This device', deviceToggle, h('p', { class: `channel-note${deviceWarnNow ? ' warn' : ''}`, id: 'alerts-device-status', role: 'status' }, deviceStatus)))),

    // 4. Your data
    h('section', { class: 'card alerts-card', 'aria-labelledby': 'h-data' },
      h('h3', { id: 'h-data' }, 'Your data'),
      h('p', { class: 'channel-note' }, account.user
        ? 'Your profile, pins and alert settings are saved on this device and in your account.'
        : 'Your profile, pins and alert settings are saved on this device only.'),
      button('delete-all-data', 'Delete my saved data', deleteEverything, 'text-button danger')),
  ].filter(Boolean)); // (a missing card is null; never print it)
}

const scopeValue = (scope) => (scope === 'chosen' || scope === 'nearby' ? scope : 'pinned');

function profileLink() {
  const b = h('button', { type: 'button', class: 'text-button inline-link' }, 'Open Rider Profile');
  b.addEventListener('click', openProfile);
  return b;
}

// ---------- Choosing places for alerts ----------

let deviceMsg = ''; // what happened when you last switched device notifications on
let deviceWarn = false; // ...and whether it's a problem (shown in warning color)

const unsupportedText = () => (/iPhone|iPad/.test(navigator.userAgent)
  ? 'On iPhone, notifications work in the Home Screen app: tap Share → Add to Home Screen, open it from there, then turn this on.'
  : 'This browser can’t show notifications. Try Chrome, Edge, Firefox or Safari.');

// Ask for permission to show notifications: 'granted', 'denied' or 'default' (no
// answer: the prompt was closed, or the browser didn't show it). Works with older
// Safari too, which answers through a callback instead of a promise.
function askPermission() {
  if (Notification.permission !== 'default') return Promise.resolve(Notification.permission);
  return new Promise((resolve) => {
    try {
      const p = Notification.requestPermission((answer) => resolve(answer));
      if (p?.then) p.then(resolve, () => resolve(Notification.permission));
    } catch {
      resolve(Notification.permission);
    }
  });
}

// Wait for a promise, but never longer than ms (some browsers never answer push requests)
const withTimeout = (promise, ms) => Promise.race([promise, new Promise((r) => setTimeout(() => r(false), ms))]);

// "Delete my saved data": everything this site saved on this device, and (signed in)
// your account's copy, which also signs you out. It asks first in a dialog on the page
// (a browser confirm() box can be silently blocked, e.g. in the Home Screen app), and
// the dialog says exactly what goes and what stays.
function deleteEverything() {
  const signedIn = Boolean(account.user);
  const li = (text) => h('li', {}, text);
  const cancel = h('button', { type: 'button', class: 'action-button' }, 'Cancel');
  const go = h('button', { type: 'button', class: 'action-button danger-button' }, 'Delete my data');
  const msg = h('p', { class: 'channel-note warn', role: 'alert', hidden: true });
  const dialog = h('dialog', { class: 'detail confirm-delete', 'aria-labelledby': 'confirm-delete-title' },
    h('div', { class: 'confirm-body' },
      h('h2', { id: 'confirm-delete-title' }, 'Delete my saved data?'),
      h('p', {}, 'This deletes, on this device:'),
      h('ul', {},
        li('Your Rider Profile (skill, home area and how far you’ll go)'),
        li('Your pinned mountains and beaches'),
        li('Your alert settings (what to alert you about, where, by email and on this device), and this device’s morning notifications')),
      signedIn ? h('p', {}, `And in your account (${account.user.email}), the whole saved copy:`) : null,
      signedIn ? h('ul', {},
        li('Your name, email address and any other alert email address'),
        li('Your Rider Profile, pins and alert settings'),
        li('Every device’s notification sign-up')) : null,
      h('p', { class: 'fine' }, `It keeps your light/dark and animation settings on this device (and doesn’t show the welcome walkthrough again).${signedIn ? ' You’ll be signed out. Your Google account isn’t touched, and Google’s Firebase keeps its basic sign-in record (your email and an ID). Alert emails already sent stay in your inbox.' : ''} This can’t be undone.`),
      msg,
      h('div', { class: 'confirm-actions' }, cancel, go)));
  const close = () => { dialog.close(); dialog.remove(); };
  cancel.addEventListener('click', close);
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); if (!go.disabled) close(); }); // Esc
  go.addEventListener('click', async () => {
    go.disabled = cancel.disabled = true;
    go.textContent = 'Deleting…';
    // The account's copy first: if that fails, nothing at all has been deleted
    if (account.user) {
      try {
        await deleteMyData();
      } catch {
        msg.textContent = 'Couldn’t delete your account’s saved data. Check your connection and try again. Nothing was deleted.';
        msg.hidden = false;
        go.disabled = cancel.disabled = false;
        go.textContent = 'Try again';
        return;
      }
    }
    try { await withTimeout(setPush(false), 5000); } catch { /* ignore */ }
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith('ssr-') && !['ssr-theme', 'ssr-motion', 'ssr-welcome'].includes(k)) localStorage.removeItem(k);
    } catch { /* private mode: nothing saved anyway */ }
    location.hash = 'alerts';
    location.reload();
  });
  document.body.append(dialog);
  dialog.showModal();
  cancel.focus();
}
let confirmMsg = ''; // after opening a link from a confirmation email
const pickerOpen = { snow: false, surf: false };
const pickerQuery = { snow: '', surf: '' };
// The picker's filters (kept while the page is open)
const pickerFilter = {
  snow: { area: 'all', pass: 'all', show: 'all', sort: 'name' },
  surf: { area: 'all', pass: 'all', show: 'all', sort: 'name' },
};
const NOUN = { snow: ['mountain', 'mountains'], surf: ['beach', 'beaches'] };

function toggleWatch(kind, id) {
  const settings = loadSettings();
  const key = `${kind}Watch`;
  let list = settings[`${kind}Scope`] === 'chosen' ? settings[key] : [];
  if (settings[`${kind}Scope`] !== 'chosen') {
    // Switching from "pinned" or "near me" to "chosen": start from the places
    // you were already getting alerts for
    list = report.sections[kind].items.filter((x) => isWatched(kind, x.id)).map((x) => x.id);
  }
  list = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  saveSettings({ ...settings, [`${kind}Scope`]: 'chosen', [key]: list });
}

function isWatched(kind, id) {
  const s = loadSettings();
  const scope = s[`${kind}Scope`];
  if (scope === 'chosen') return s[`${kind}Watch`].includes(id);
  if (scope === 'nearby') {
    const rider = loadRider();
    return Boolean(rider.home) && withinReach(report.sections[kind].items.find((x) => x.id === id), rider);
  }
  return ((kind === 'snow' ? snowTab : surfTab)?.pinned() ?? []).includes(id);
}

// The chosen places, and a searchable tap-to-add list of every place
function chooser(kind) {
  const settings = loadSettings();
  const rider = loadRider();
  const [one, many] = NOUN[kind];
  const items = [...report.sections[kind].items].sort((a, b) => a.name.localeCompare(b.name));
  const chosen = items.filter((x) => settings[`${kind}Watch`].includes(x.id));
  const summary = h('p', { class: 'fine chooser-summary' },
    chosen.length
      ? `${chosen.length} chosen: ${chosen.slice(0, 6).map((x) => x.name).join(', ')}${chosen.length > 6 ? `, +${chosen.length - 6} more` : ''}`
      : `No ${many} chosen yet. Tap “Choose ${many}”, or tap 🔔 Notify me on any ${one}.`);
  const openButton = button(`choose-${kind}`, pickerOpen[kind] ? 'Done' : `Choose ${many}`, () => {
    pickerOpen[kind] = !pickerOpen[kind];
    refresh();
  }, 'text-button');
  const wrap = h('div', { class: 'chooser' }, summary, openButton);
  if (!pickerOpen[kind]) return wrap;

  const search = h('input', { type: 'search', id: `choose-${kind}-search`, placeholder: `Search ${many}`, autocomplete: 'off', value: pickerQuery[kind] });
  const listEl = h('ul', { class: 'chooser-list' }, items.map((x) => {
    const on = chosen.includes(x);
    const miles = rider.home ? distanceMi(rider.home, x) : null;
    const b = h('button', { type: 'button', class: 'chooser-item', 'aria-pressed': String(on), 'data-id': x.id, 'data-name': `${x.name} ${x.city ?? ''} ${x.region}`.toLowerCase() },
      h('span', { class: 'chooser-check', 'aria-hidden': 'true' }, on ? '✓' : '+'),
      h('span', {}, x.name, h('span', { class: 'chooser-where' }, ` ${x.city ? `${x.city}, ` : ''}${x.region}${miles != null ? ` · ${miles} mi` : ''}`)));
    b.addEventListener('click', () => {
      toggleWatch(kind, x.id);
      // Update this button and the summary in place (no full redraw, so the list
      // keeps its scroll position and your search text)
      const nowOn = loadSettings()[`${kind}Watch`].includes(x.id);
      b.setAttribute('aria-pressed', String(nowOn));
      b.querySelector('.chooser-check').textContent = nowOn ? '✓' : '+';
      const ids = loadSettings()[`${kind}Watch`];
      const names = items.filter((i) => ids.includes(i.id)).map((i) => i.name);
      summary.textContent = names.length ? `${names.length} chosen: ${names.slice(0, 6).join(', ')}${names.length > 6 ? `, +${names.length - 6} more` : ''}` : `No ${many} chosen yet.`;
      const box = document.getElementById('heads-up-list');
      const alerts = currentAlerts();
      if (box) box.replaceChildren(headsUpList(alerts));
      updateBadge();
      saveSoon();
    });
    return h('li', {}, b);
  }));
  // Filters: area, pass (mountains), which ones to show, and the order
  const pf = pickerFilter[kind];
  const byId = Object.fromEntries(items.map((x) => [x.id, x]));
  const pinnedIds = (kind === 'snow' ? snowTab : surfTab).pinned();
  const areas = [...new Set(report.sections[kind].items.map((x) => x.area).filter(Boolean))].sort();
  const filterSelect = (name, label, options) => select(`choose-${kind}-${name}`, label, options, pf[name], (v) => { pf[name] = v; applySearch(); });
  const filters = h('div', { class: 'list-controls chooser-filters' },
    filterSelect('area', 'Area', [['all', 'All areas'], ...areas.map((a) => [a, a])]),
    kind === 'snow' ? filterSelect('pass', 'Pass', [['all', 'All passes'], ['Ikon', 'Ikon'], ['Epic', 'Epic']]) : null,
    filterSelect('show', 'Show', [
      ['all', `All ${many}`],
      ['chosen', 'Chosen only'],
      ['unchosen', 'Not chosen yet'],
      ['pinned', 'My pinned'],
      ...(rider.home ? [['near', `Within ${rider.radiusMi ?? '∞'} mi`]] : []),
    ]),
    filterSelect('sort', 'Order', [['name', 'A–Z'], ...(rider.home ? [['distance', 'Closest first']] : [])]));
  const shownCount = h('p', { class: 'fine chooser-count', 'aria-live': 'polite' });

  const applySearch = () => {
    pickerQuery[kind] = search.value.trim().toLowerCase();
    const watch = loadSettings()[`${kind}Watch`];
    const passes = (x) => (x.passes ?? []).map((p) => p.pass);
    const rows = [...listEl.children];
    let shown = 0;
    for (const li of rows) {
      const b = li.firstChild;
      const x = byId[b.dataset.id];
      const ok = b.dataset.name.includes(pickerQuery[kind])
        && (pf.area === 'all' || x.area === pf.area)
        && (pf.pass === 'all' || passes(x).includes(pf.pass))
        && (pf.show === 'all'
          || (pf.show === 'chosen' && watch.includes(x.id))
          || (pf.show === 'unchosen' && !watch.includes(x.id))
          || (pf.show === 'pinned' && pinnedIds.includes(x.id))
          || (pf.show === 'near' && withinReach(x, rider)));
      li.hidden = !ok;
      if (ok) shown++;
    }
    // Reorder: A–Z, or closest to your home first
    const key = (li) => byId[li.firstChild.dataset.id];
    rows.sort((a, b) => (pf.sort === 'distance' && rider.home
      ? distanceMi(rider.home, key(a)) - distanceMi(rider.home, key(b)) : 0) || key(a).name.localeCompare(key(b).name));
    listEl.append(...rows);
    shownCount.textContent = shown === items.length ? `All ${items.length} ${many}` : `Showing ${shown} of ${items.length} ${many}`;
  };
  search.addEventListener('input', applySearch);
  wrap.append(h('label', { class: 'control grow chooser-search' }, h('span', {}, 'Search'), search), filters, shownCount, listEl);
  applySearch();
  return wrap;
}

// The "Heads up now" list (also used to refresh it in place)
function headsUpList(alerts) {
  return h('div', {}, matchesList(alerts), watchingList());
}

// Everything your alerts cover, with how each looks today (✓ = matches now), so
// you can see your chosen mountains and beaches even on days nothing matches.
let watchingOpen = null; // remembers if you opened or closed the list
function watchingList() {
  const w = watching(report, loadSettings(), loadProfile(), pins(), loadRider());
  const total = w.snow.length + w.surf.length;
  if (!total) return null;
  const group = (kind, title) => (w[kind].length ? [
    h('h4', {}, `${title} (${w[kind].length})`),
    h('ul', { class: 'watch-list' }, w[kind].map(({ item, status, match }) => {
      const b = h('button', { type: 'button', class: `watch-item${match ? ' is-match' : ''}` },
        h('span', { class: 'watch-mark', 'aria-hidden': 'true' }, match ? '✓' : '·'),
        h('span', { class: 'watch-name' }, item.name),
        h('span', { class: 'watch-status' }, match ? `Matches now · ${status}` : status));
      b.addEventListener('click', () => { location.hash = `${kind}/${item.id}`; });
      return h('li', {}, b);
    })),
  ] : null);
  const box = h('details', { class: 'watching' },
    h('summary', {}, `Watching ${plural(w.snow.length, 'mountain', 'mountains')} and ${plural(w.surf.length, 'beach', 'beaches')}`),
    group('snow', 'Mountains'),
    group('surf', 'Beaches'));
  box.open = watchingOpen ?? false;
  box.addEventListener('toggle', () => { watchingOpen = box.open; });
  return box;
}

// A bell, drawn (so it matches the tab bar icon)
const bellIcon = () => {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', 'M12 2a6 6 0 0 0-6 6v3.6L4.3 15A1 1 0 0 0 5.2 16.5h13.6a1 1 0 0 0 .9-1.5L18 11.6V8a6 6 0 0 0-6-6Zm0 20a3 3 0 0 0 2.8-2H9.2A3 3 0 0 0 12 22Z');
  svg.append(path);
  return svg;
};

// How these reach you, in one line
function sentNote() {
  const ways = [];
  if (account.user && account.emailAlerts) ways.push('email');
  if (loadSettings().deviceOn) ways.push('this device');
  return ways.length
    ? `Sent to your ${ways.join(' and ')} in the morning. Tap one for the details.`
    : 'Tap one for the details. Turn on email or phone alerts below to get these each morning.';
}

function matchesList(alerts) {
  const settings = loadSettings();
  return alerts.length
    ? h('ul', { class: 'alert-list' }, alerts.map((a) => {
      const b = h('button', { type: 'button', class: `alert-item alert-${a.kind}` },
        h('span', { class: 'alert-icon', 'aria-hidden': 'true' }, a.kind === 'snow' ? '❄' : '🌊'),
        h('span', { class: 'alert-text' },
          h('span', { class: 'alert-kind' }, a.kind === 'snow' ? 'Snow alert' : 'Surf alert'),
          h('span', { class: 'alert-title' }, a.title),
          h('span', { class: 'alert-detail' }, a.detail)),
        h('span', { class: 'alert-go', 'aria-hidden': 'true' }, '›'));
      b.addEventListener('click', () => { location.hash = a.hash; });
      return h('li', {}, b);
    }))
    : (settings.snowOn || settings.surfOn
      ? null
      : h('p', { class: 'empty' }, 'Alerts are off. Turn on snow or surf alerts below.'));
}

// "🔔 Notify me" button for a mountain or beach detail view
function syncNotifyButton(b) {
  const on = isWatched(b.dataset.kind, b.dataset.id);
  b.setAttribute('aria-pressed', String(on));
  b.textContent = on ? '🔔 Notifying' : '🔔 Notify me';
}

export function notifyButton(kind, item) {
  const b = h('button', { type: 'button', class: 'pin-button with-text notify-button', 'data-kind': kind, 'data-id': item.id, 'aria-label': `Alerts for ${item.name}` });
  syncNotifyButton(b);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleWatch(kind, item.id);
    syncNotifyButton(b);
    refresh();
    saveSoon();
  });
  return b;
}
