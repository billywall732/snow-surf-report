// "Sign in with Google" + saving your alert preferences to your account, so the
// morning email and phone notifications (sent by the GitHub Action) know what to
// send you, and so your settings follow you to other devices.
//
// Uses the sign-in shared by every app on offthewall.dev (Supabase, /shared/auth.js):
//   - Google sign-in tells us only your name and email address; the app never gets
//     access to your Gmail.
//   - Your setup is one row in the ssr_users table. Row-level security lets only you
//     read or change it, and the fields the morning job keeps (confirmed addresses,
//     when it last emailed you) can't be written from the browser. The tables and
//     their tests live in the private offthewall-db repo.
// The sign-in code is only downloaded when someone taps "Sign in" (or was signed in
// before), so the page stays fast for everyone else.

// Kill switch: false hides every sign-in button, and the Notifications tab says email
// alerts are coming soon.
const SIGN_IN_OPEN = true;
export const isConfigured = SIGN_IN_OPEN;

const AUTH_SCRIPTS = ['/shared/vendor/supabase-2.118.0.js', '/shared/auth.js'];
const SESSION_KEY = 'sb-yxdmuznxcqcauyehhfmp-auth-token'; // where the shared sign-in keeps its session

// What the rest of the app sees
export const account = {
  user: null, // { uid, email, name } when signed in
  emailAlerts: false, // "email me a morning summary"
  alertEmail: '', // where emails go, if not your Google address
  verifiedEmails: [], // other addresses you've confirmed (only the Action can add to this)
  busy: false, // signing in / loading
  error: '',
};

let auth = null; // window.otwAuth once loaded
let loading = null;
let hooks = null; // { getPrefs, applyPrefs } from alerts.js
let applying = false; // true while copying saved settings into the app (don't save them back)
let saveTimer = null;
let handledId; // the person handleUser last set up (undefined = nobody yet)
const listeners = new Set();
const changed = () => { for (const fn of listeners) fn(account); };
export const onAccountChange = (fn) => listeners.add(fn);

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Couldn't load ${src}`));
    document.head.append(s);
  });
}

async function loadAuth() {
  if (auth) return auth;
  loading ??= (async () => {
    if (!window.otwAuth) {
      if (!window.supabase) await loadScript(AUTH_SCRIPTS[0]);
      await loadScript(AUTH_SCRIPTS[1]);
    }
    if (!window.otwAuth) throw new Error('Sign-in is unavailable');
    auth = window.otwAuth;
    auth.onChange((u) => { handleUser(u); }); // signed in or out, here or in another tab
    return auth;
  })();
  try {
    return await loading;
  } catch (err) {
    loading = null;
    throw err;
  }
}

const table = () => auth.db.from('ssr_users');
const hasSession = () => { try { return Boolean(localStorage.getItem(SESSION_KEY)); } catch { return false; } };

// hooks.getPrefs() -> { settings, profile, pins, rider }   (what to save)
// hooks.applyPrefs(prefs)                                   (put saved prefs into the app)
export async function initAccount(h) {
  hooks = h;
  if (!isConfigured) return;
  // Only load the sign-in code for someone signed in before, or just back from Google
  if (!hasSession() && !/[?&]code=/.test(location.search)) return;
  account.busy = true;
  changed();
  try {
    const a = await loadAuth();
    await handleUser(await a.ready);
  } catch {
    account.busy = false;
    account.error = 'Couldn’t reach the sign-in service. Check your connection.';
    changed();
  }
}

// Start loading the sign-in code early (e.g. when a finger touches a sign-in button).
export function warmUp() {
  if (isConfigured) loadAuth().catch(() => {});
}

// Off to Google, then back to this page (signed in).
export async function signIn() {
  account.busy = true;
  account.error = '';
  changed();
  try {
    const a = await loadAuth();
    const res = await a.signIn();
    if (res?.error) throw res.error;
  } catch {
    account.busy = false;
    account.error = 'Sign-in didn’t work. Please try again.';
    changed();
  }
}

export async function signOut() {
  if (!auth) return;
  await auth.signOut();
  await handleUser(null);
}

// Remove everything saved in your account, then sign out. Throws if the delete fails.
export async function deleteMyData() {
  if (!auth || !account.user) return;
  const { error } = await table().delete().eq('user_id', account.user.uid);
  if (error) throw new Error(error.message);
  await signOut();
}

// Where alert emails go. Your Google address works right away; another address
// gets a confirmation link first (sent by the hourly Action), so nobody can sign
// up someone else. '' means "my Google address".
export const emailTarget = () => account.alertEmail || account.user?.email || '';
export const emailConfirmed = () => !account.alertEmail
  || account.alertEmail === account.user?.email?.toLowerCase()
  || account.verifiedEmails.includes(account.alertEmail);

export async function setAlertEmail(address) {
  if (!account.user || !auth) return;
  const clean = address.trim().toLowerCase();
  account.alertEmail = clean === account.user.email.toLowerCase() ? '' : clean;
  changed();
  await write({ alert_email: account.alertEmail || null });
}

// This device's push subscription (morning notifications even when the app is
// closed). null removes it.
export async function savePushSub(deviceId, sub) {
  if (!account.user || !auth) return false;
  const { error } = await auth.db.rpc('ssr_set_push_sub', { device_id: deviceId, sub: sub ?? null });
  return !error;
}

// The link in a confirmation email opens #confirm/<code>. Recording the code is
// all it takes: the next hourly run sees it and starts sending to that address.
// Works without signing in (the email may open in a different browser).
export async function confirmEmail(code) {
  try {
    const a = await loadAuth();
    const { error } = await a.db.from('ssr_email_confirmations').insert({ token: code });
    return !error || error.code === '23505'; // 23505: already recorded (link opened twice)
  } catch {
    return false;
  }
}

// Update this person's row, creating it if it isn't there yet.
async function write(fields) {
  try {
    const upd = await table().update(fields).eq('user_id', account.user.uid).select('user_id');
    if (upd.error) throw upd.error;
    if (!upd.data.length) {
      const ins = await table().insert(fields);
      if (ins.error) throw ins.error;
    }
    return true;
  } catch {
    account.error = 'Couldn’t save that to your account. Please try again.';
    changed();
    return false;
  }
}

export function setEmailAlerts(on) {
  account.emailAlerts = on;
  changed();
  saveSoon();
}

// Call this whenever a setting, pin, level/board or Rider Profile changes.
export function saveSoon() {
  if (!account.user || applying) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 800); // a burst of taps becomes one save
}

async function save() {
  if (!account.user || !auth) return;
  const { settings, profile, pins, rider } = hooks.getPrefs();
  const ok = await write({ name: account.user.name, email_alerts: account.emailAlerts, settings, profile, pins, rider: rider ?? null });
  if (!ok) {
    account.error = 'Couldn’t save your settings to your account. They’re still saved on this device.';
    changed();
  }
}

async function handleUser(u) {
  const id = u?.id ?? null;
  if (id === handledId) return; // already set up for this person (or already signed out)
  handledId = id;

  if (!u) {
    clearTimeout(saveTimer);
    Object.assign(account, { user: null, emailAlerts: false, alertEmail: '', verifiedEmails: [], busy: false });
    changed();
    return;
  }
  const p = auth.profile(u);
  const named = u.user_metadata?.full_name || u.user_metadata?.name || '';
  account.user = { uid: u.id, email: (u.email ?? '').toLowerCase(), name: named || p.name || '' };
  account.busy = true;
  account.error = '';
  changed();
  try {
    const { data, error } = await table()
      .select('email_alerts, alert_email, verified_emails, settings, profile, pins, rider')
      .eq('user_id', u.id).maybeSingle();
    if (error) throw error;
    if (data && data.settings) {
      // Your account already has settings: use them on this device too
      account.emailAlerts = Boolean(data.email_alerts);
      account.alertEmail = data.alert_email ?? '';
      account.verifiedEmails = data.verified_emails ?? [];
      applying = true;
      hooks.applyPrefs({ settings: data.settings, profile: data.profile, pins: data.pins, rider: data.rider ?? undefined });
      applying = false;
    } else {
      // First sign-in: save this device's settings to the new account
      account.emailAlerts = true;
      await save();
    }
  } catch {
    account.error = 'Couldn’t load your saved settings.';
  }
  account.busy = false;
  changed();
}
