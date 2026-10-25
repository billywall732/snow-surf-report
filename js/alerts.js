// The Notifications tab: set up alerts for snow coming to your mountains and
// waves that fit your levels and boards, see what matches right now, and (signed in
// with Google) get a morning email when something matches.
//
// How alerts reach you:
//   - In the app: listed here, with a red badge on the Notifications tab.
//   - On this device: optionally a notification for anything new when you open the
//     app (browsers that support it; on iPhone only after "Add to Home Screen").
//   - By email: sign in with Google; your settings save to your account and the
//     morning GitHub Action emails you a summary when something matches.
// Without signing in, settings are saved in this browser only.
import { h } from './ui.js';
import { computeAlerts, DEFAULT_SETTINGS, watching } from './alert-rules.js';
import { hasProfile, loadProfile, onProfileChange, profileText, saveProfile } from './skill.js';
import { loadRider, onRiderChange, openProfile, saveRider } from './rider.js';
import { distanceMi, normalizeRider, withinReach } from './recommend.js';
import { account, deleteMyData, initAccount, isConfigured, onAccountChange, saveSoon, setEmailAlerts, signIn, signOut } from './account.js';

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
  onAccountChange(refresh);

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

// The "Email alerts" card: not set up / signed out / signed in
function emailCard() {
  const parts = [h('h3', { id: 'h-email' }, 'Email alerts')];
  if (!isConfigured) {
    parts.push(h('p', { class: 'fine' }, 'Email alerts aren’t switched on for this site yet.'));
  } else if (!account.user) {
    parts.push(
      h('p', {}, 'Sign in with Google to get a morning email when something matches. Your settings will save to your account, so you can change them here any time, on any device.'),
      button('sign-in', account.busy ? 'Signing in…' : 'Sign in with Google', () => signIn(), 'action-button google'),
      h('p', { class: 'fine' }, 'We only use your name and email address, to send your alerts. We never see your Gmail.'));
  } else {
    parts.push(
      h('p', {}, 'Signed in as ', h('strong', {}, account.user.email)),
      toggle('email-on', 'Email me a morning summary when something matches', account.emailAlerts, (on) => setEmailAlerts(on)),
      h('p', { class: 'fine' }, 'Emails go out around 5 AM Pacific, only on days something matches. Your settings save to your account automatically.'),
      h('div', { class: 'account-actions' },
        button('sign-out', 'Sign out', () => signOut(), 'text-button'),
        button('delete-data', 'Delete my saved data', async () => {
          if (confirm('Delete your saved settings and stop all emails? You can sign in again later.')) await deleteMyData();
        }, 'text-button danger')));
  }
  if (account.busy && account.user) parts.push(h('p', { class: 'fine' }, 'Loading your saved settings…'));
  if (account.error) parts.push(h('p', { class: 'fine warn', role: 'alert' }, account.error));
  return h('section', { class: 'card alerts-card', 'aria-labelledby': 'h-email' }, parts);
}

function render() {
  const settings = loadSettings();
  // Change a setting: save on this device, then (if signed in) to your account
  const update = (changes) => { saveSettings({ ...loadSettings(), ...changes }); refresh(); saveSoon(); };
  const alerts = currentAlerts(settings);

  const list = headsUpList(alerts);

  const rider = loadRider();
  const surfNote = !hasProfile()
    ? h('p', { class: 'fine warn' }, 'Pick a level or board in your Rider Profile to get surf alerts. ', profileLink())
    : h('p', { class: 'fine' }, `Waves that fit ${/^[aeiou]/i.test(profileText()) ? 'an' : 'a'} ${profileText()} in the next 3 days (at ${report.sections.surf.sessionHour ?? 7} AM)${rider.surf.minWaterF ? `, in water ${rider.surf.minWaterF}°F or warmer` : ''}.`);
  // "Near me" needs a home in the Rider Profile
  const nearNote = (scope, extra = '') => (scope === 'nearby'
    ? h('p', { class: 'fine' + (rider.home ? '' : ' warn') }, rider.home
      ? `Everywhere ${rider.radiusMi ? `within ${rider.radiusMi} mi of ` : 'from '}${rider.home.label}${extra}. `
      : 'Set where you ride from in your Rider Profile to use this. ', profileLink())
    : null);
  const scopes = (many) => [['pinned', `My pinned ${many}`], ['chosen', `${many[0].toUpperCase()}${many.slice(1)} I choose`], ['nearby', `${many[0].toUpperCase()}${many.slice(1)} near me`]];

  let deviceStatus = deviceMsg;
  if (!canNotify()) {
    deviceStatus = /iPhone|iPad/.test(navigator.userAgent)
      ? 'On iPhone, notifications only work in the app version: tap Share → Add to Home Screen, open Snow and Surf from your Home Screen, and turn this on there.'
      : 'This browser can’t show notifications.';
  } else if (Notification.permission === 'denied') {
    deviceStatus = 'Notifications are blocked for this site. Allow them in your browser’s site settings, then try again.';
  } else if (!deviceStatus && settings.deviceOn && Notification.permission === 'granted') {
    deviceStatus = 'On: you’ll get a notification for anything new each time you open the app.';
  }
  const deviceToggle = toggle('alerts-device', 'Notify me on this device when I open the app and something new matches', settings.deviceOn && canNotify(), async (on) => {
    deviceMsg = '';
    if (on && canNotify() && Notification.permission === 'default') await Notification.requestPermission();
    const granted = on && canNotify() && Notification.permission === 'granted';
    saveSettings({ ...loadSettings(), deviceOn: granted });
    if (granted) {
      // Show something right away, so you know it works
      const sent = await notifyDevice();
      if (sent) {
        deviceMsg = `On: we just sent ${Math.min(sent, 3)} notification${sent === 1 ? '' : 's'} for what matches now.`;
      } else {
        const shown = await showNotification('Snow and Surf notifications are on', 'You’ll get a notification here when something new matches your alerts.', 'alerts', 'ssr-test');
        deviceMsg = shown ? 'On: we just sent a test notification.' : 'This browser blocked the notification. On a phone, try the Home Screen app.';
      }
    }
    refresh();
  });
  if (!canNotify()) deviceToggle.querySelector('input').disabled = true;

  panel().replaceChildren(
    h('div', { class: 'section-head' },
      h('h2', {}, 'Notifications'),
      h('p', { class: 'fine' }, 'A heads-up about snow coming to your mountains and waves that fit you.')),

    h('section', { class: 'card alerts-card', 'aria-labelledby': 'h-heads-up' },
      h('h3', { id: 'h-heads-up' }, 'Heads up now'),
      h('div', { id: 'heads-up-list' }, list)),

    emailCard(),

    h('section', { class: 'card alerts-card', 'aria-labelledby': 'h-snow-alerts' },
      h('h3', { id: 'h-snow-alerts' }, 'Snow alerts'),
      toggle('alerts-snow-on', 'Tell me when snow is coming', settings.snowOn, (on) => update({ snowOn: on })),
      h('div', { class: 'list-controls' },
        select('alerts-snow-inches', 'At least', [2, 4, 6, 10, 12].map((n) => [n, `${n}" in the next 3 days`]), settings.snowInches, (v) => update({ snowInches: Number(v) })),
        select('alerts-snow-scope', 'For', scopes('mountains'), scopeValue(settings.snowScope), (v) => update({ snowScope: v }))),
      nearNote(settings.snowScope, rider.ski.passes.length ? ` on the ${rider.ski.passes.join(' or ')} Pass` : ''),
      settings.snowScope === 'chosen' ? chooser('snow') : null,
      rider.ski.ride.length === 1 && rider.ski.ride[0] === 'snowboard' ? h('p', { class: 'fine' }, 'You snowboard, so skiers-only mountains are left out.') : null),

    h('section', { class: 'card alerts-card', 'aria-labelledby': 'h-surf-alerts' },
      h('h3', { id: 'h-surf-alerts' }, 'Surf alerts'),
      toggle('alerts-surf-on', 'Tell me when waves fit my level and board', settings.surfOn, (on) => update({ surfOn: on })),
      surfNote,
      h('div', { class: 'list-controls' },
        select('alerts-surf-scope', 'For', scopes('beaches'), scopeValue(settings.surfScope), (v) => update({ surfScope: v }))),
      nearNote(settings.surfScope),
      settings.surfScope === 'chosen' ? chooser('surf') : null),

    h('section', { class: 'card alerts-card', 'aria-labelledby': 'h-device' },
      h('h3', { id: 'h-device' }, 'On this device'),
      deviceToggle,
      deviceStatus ? h('p', { class: 'fine' }, deviceStatus) : null),
  );
}

const scopeValue = (scope) => (scope === 'chosen' || scope === 'nearby' ? scope : 'pinned');

function profileLink() {
  const b = h('button', { type: 'button', class: 'text-button inline-link' }, 'Open Rider Profile');
  b.addEventListener('click', openProfile);
  return b;
}

// ---------- Choosing places for alerts ----------

let deviceMsg = ''; // what happened when you last switched device notifications on
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
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const box = h('details', { class: 'watching' },
    h('summary', {}, `Watching ${plural(w.snow.length, 'mountain', 'mountains')} and ${plural(w.surf.length, 'beach', 'beaches')}`),
    group('snow', 'Mountains'),
    group('surf', 'Beaches'));
  box.open = watchingOpen ?? total <= 10;
  box.addEventListener('toggle', () => { watchingOpen = box.open; });
  return box;
}

function matchesList(alerts) {
  const settings = loadSettings();
  return alerts.length
    ? h('ul', { class: 'alert-list' }, alerts.map((a) => {
      const b = h('button', { type: 'button', class: `alert-item alert-${a.kind}` },
        h('span', { class: 'alert-title' }, a.title),
        h('span', { class: 'alert-detail' }, a.detail));
      b.addEventListener('click', () => { location.hash = a.hash; });
      return h('li', {}, b);
    }))
    : h('p', { class: 'empty' }, settings.snowOn || settings.surfOn
      ? 'Nothing matches right now. Conditions are checked every morning.'
      : 'Alerts are off. Turn on snow or surf alerts below.');
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
