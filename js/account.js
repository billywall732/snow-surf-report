// "Sign in with Google" + saving your alert preferences to your account, so the
// morning email (sent by the GitHub Action) knows what to send you, and so your
// settings follow you to other devices.
//
// Uses Firebase (Google's free app backend):
//   - Firebase Authentication does the Google sign-in. We only learn your name and
//     email address; the app never gets access to your Gmail.
//   - Firestore stores one record per person at users/<your id>. firestore.rules
//     lets only you read or change your own record.
// Firebase's code is only downloaded when someone taps "Sign in" (or was signed in
// before), so the page stays fast for everyone else.
import { firebaseConfig } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2'; // pinned version
const SIGNED_IN_KEY = 'ssr-signed-in';

export const isConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

// What the rest of the app sees
export const account = {
  user: null, // { uid, email, name } when signed in
  emailAlerts: false, // "email me a morning summary"
  busy: false, // signing in / loading
  error: '',
};

let fb = null; // the loaded Firebase pieces
let hooks = null; // { getPrefs, applyPrefs } from app.js
let applying = false; // true while copying cloud settings into the app (don't save them back)
let saveTimer = null;
const listeners = new Set();
const changed = () => { for (const fn of listeners) fn(account); };
export const onAccountChange = (fn) => listeners.add(fn);

async function loadFirebase() {
  if (fb) return fb;
  const [{ initializeApp }, auth, store] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  fb = { auth, store, authApp: auth.getAuth(app), db: store.getFirestore(app) };
  // Runs on sign-in, sign-out, and when a page loads with you already signed in
  auth.onAuthStateChanged(fb.authApp, (u) => { handleUser(u); });
  return fb;
}

// hooks.getPrefs() -> { settings, profile, pins, rider }   (what to save)
// hooks.applyPrefs(prefs)                           (put saved prefs into the app)
export async function initAccount(h) {
  hooks = h;
  if (!isConfigured) return;
  let wasSignedIn = false;
  try { wasSignedIn = localStorage.getItem(SIGNED_IN_KEY) === '1'; } catch { /* ignore */ }
  if (wasSignedIn) {
    account.busy = true;
    changed();
    try {
      await loadFirebase(); // onAuthStateChanged will tell us who's signed in
    } catch {
      account.busy = false;
      account.error = 'Couldn’t reach the sign-in service. Check your connection.';
      changed();
    }
  }
}

export async function signIn() {
  account.busy = true;
  account.error = '';
  changed();
  try {
    const { auth, authApp } = await loadFirebase();
    const provider = new auth.GoogleAuthProvider();
    try {
      await auth.signInWithPopup(authApp, provider);
    } catch (err) {
      // Some phones block pop-ups: fall back to a full-page Google sign-in
      if (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment') {
        // Remember to load Firebase when Google sends you back, to finish signing in
        try { localStorage.setItem(SIGNED_IN_KEY, '1'); } catch { /* ignore */ }
        await auth.signInWithRedirect(authApp, provider);
        return;
      }
      throw err;
    }
  } catch (err) {
    account.busy = false;
    account.error = err.code === 'auth/popup-closed-by-user' ? '' : 'Sign-in didn’t work. Please try again.';
    changed();
  }
}

export async function signOut() {
  if (!fb) return;
  await fb.auth.signOut(fb.authApp);
}

// Remove everything saved in your account, then sign out.
export async function deleteMyData() {
  if (!fb || !account.user) return;
  await fb.store.deleteDoc(fb.store.doc(fb.db, 'users', account.user.uid));
  await signOut();
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
  if (!account.user || !fb) return;
  const { settings, profile, pins, rider } = hooks.getPrefs();
  try {
    await fb.store.setDoc(fb.store.doc(fb.db, 'users', account.user.uid), {
      email: account.user.email,
      name: account.user.name,
      emailAlerts: account.emailAlerts,
      settings,
      profile,
      pins,
      rider,
      updatedAt: fb.store.serverTimestamp(),
    }, { merge: true });
  } catch {
    account.error = 'Couldn’t save your settings to your account. They’re still saved on this device.';
    changed();
  }
}

async function handleUser(u) {
  try {
    if (u) localStorage.setItem(SIGNED_IN_KEY, '1');
    else localStorage.removeItem(SIGNED_IN_KEY);
  } catch { /* ignore */ }

  if (!u) {
    Object.assign(account, { user: null, emailAlerts: false, busy: false });
    changed();
    return;
  }
  account.user = { uid: u.uid, email: u.email, name: u.displayName ?? '' };
  account.busy = true;
  changed();
  try {
    const snap = await fb.store.getDoc(fb.store.doc(fb.db, 'users', u.uid));
    if (snap.exists()) {
      // Your account already has settings: use them on this device too
      const data = snap.data();
      account.emailAlerts = Boolean(data.emailAlerts);
      applying = true;
      hooks.applyPrefs({ settings: data.settings, profile: data.profile, pins: data.pins, rider: data.rider });
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
