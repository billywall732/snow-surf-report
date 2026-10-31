// "Sign in with Google", offered up front so people do it first: on the intro
// screen, in the header on every page, and at the top of the Profile tab. Signing
// in saves the Rider Profile, pins and alert settings to your account (so they
// follow you to any device) and turns on morning alerts by email.
// (The Notifications tab has its own sign-in button too, in "How you'll hear about it".)
import { h } from './ui.js';
import { account, isConfigured, onAccountChange, signIn, warmUp } from './account.js';
import { loadRider, openProfile } from './rider.js';
import { hasRider } from './recommend.js';

// Start downloading the sign-in code the moment a finger or mouse lands on a
// sign-in button, so the Google window can open right on the tap (phones block
// windows that open too long after one).
function signInButton(id, label, cls = 'action-button google') {
  const b = h('button', { type: 'button', id, class: cls }, account.busy ? 'Signing in…' : label);
  b.addEventListener('pointerdown', warmUp, { once: true });
  b.addEventListener('focus', warmUp, { once: true });
  b.addEventListener('click', () => { nudge = true; signIn(); });
  return b;
}

// Right after signing in from one of these buttons, someone who hasn't set up a
// Rider Profile yet lands on the Profile tab to do it.
let nudge = false;
onAccountChange(() => {
  if (!nudge || !account.user || account.busy) return;
  nudge = false;
  if (!hasRider(loadRider())) openProfile();
});

// ---------- Profile tab: a card at the top ----------

export function signInCard() {
  if (!isConfigured) return null;
  if (account.user) {
    return h('div', { class: 'signed-in-note' },
      h('span', { class: 'signed-in-check', 'aria-hidden': 'true' }, '✓'),
      h('span', {}, 'Saved to your account. Signed in as ', h('strong', {}, account.user.email), '.'));
  }
  return h('section', { class: 'card signin-card', 'aria-labelledby': 'h-signin' },
    h('h3', { id: 'h-signin' }, 'Save your setup'),
    h('p', {}, 'Sign in with Google to keep your profile, pinned spots and alerts on every device, and get a morning email or phone alert when conditions line up.'),
    signInButton('profile-sign-in', 'Sign in with Google'),
    account.error ? h('p', { class: 'fine warn', role: 'alert' }, account.error) : null,
    h('p', { class: 'fine' }, 'We only use your name and email address. Not signing in? Everything still saves on this device.'));
}

// ---------- Header: "Sign in", or your initial once signed in ----------

function renderHeader() {
  const slot = document.getElementById('account-slot');
  if (!slot) return;
  if (!isConfigured) { slot.replaceChildren(); return; }
  if (account.user) {
    const initial = (account.user.name || account.user.email || '?').trim()[0].toUpperCase();
    const b = h('button', { type: 'button', class: 'avatar-button', 'aria-label': `Your profile (signed in as ${account.user.email})`, title: account.user.email }, initial);
    b.addEventListener('click', openProfile);
    slot.replaceChildren(b);
  } else {
    slot.replaceChildren(signInButton('header-sign-in', 'Sign in', 'header-sign-in'));
  }
}

// ---------- Intro screen: under Start Shredding ----------

function renderIntro() {
  const slot = document.getElementById('intro-signin');
  if (!slot) return;
  if (!isConfigured || account.user) { slot.replaceChildren(); return; }
  const b = signInButton('intro-sign-in', 'Sign in with Google', 'intro-signin-button');
  // Signing in also starts the app (the intro's own code closes it)
  b.addEventListener('click', () => document.getElementById('intro-start')?.click());
  slot.replaceChildren(b, h('span', { class: 'intro-signin-note' }, 'Saves your profile and alerts on every device'));
}

export function mountSignIn() {
  renderHeader();
  renderIntro();
  onAccountChange(() => { renderHeader(); renderIntro(); });
}
