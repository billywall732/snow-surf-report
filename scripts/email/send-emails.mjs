// Alerts by email and phone notification. Run by the GitHub Action after the report is built:
//   node scripts/email/send-emails.mjs              (real: reads Firestore, sends via Gmail + web push)
//   node scripts/email/send-emails.mjs --dry-run sample-users.json
//                                                   (test: prints what it would send, sends nothing)
//   SAMPLE=1 node scripts/email/send-emails.mjs     (one example snow email and one example
//                                                   surf email from today's report, sent to
//                                                   GMAIL_USER; nobody else gets anything)
//
// Every run (hourly):
//   - Confirms new email addresses. Someone who wants alerts at an address other
//     than their Google one gets a confirmation link first; once they tap it, the
//     address is added to their verifiedEmails and alerts go there.
// Morning runs only (MORNING=1, set by the workflow 5-11 AM Pacific):
//   - For each signed-in person, works out their alerts with the SAME rules the app
//     uses (js/alert-rules.js) and, only on days something matches and at most once
//     a day, emails them (one email for snow, a separate one for surf; designs in
//     templates.mjs) and/or sends a notification to each phone or computer they
//     turned notifications on for.
//
// Real runs need these GitHub secrets (see README "Email and phone alerts"):
//   FIREBASE_SERVICE_ACCOUNT  the service-account key JSON from Firebase
//   GMAIL_USER                the Gmail address emails are sent from
//   GMAIL_APP_PASSWORD        an App Password for that Gmail account
//   VAPID_PRIVATE_KEY         signs phone notifications (public half: js/firebase-config.js)
// and the packages firebase-admin, nodemailer and web-push (the workflow installs them).
// Without the Gmail secrets it skips email; without VAPID_PRIVATE_KEY it skips push.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { computeAlerts, DEFAULT_SETTINGS, snowComing, watching } from '../../js/alert-rules.js';
import { fitDays, hasProfile, profileText } from '../../js/fit.js';
import { vapidPublicKey } from '../../js/firebase-config.js';
import { confirmationEmail, digestEmail, snowEmail, surfEmail } from './templates.mjs';

const SITE_URL = process.env.SITE_URL || 'https://offthewall.dev/snow-surf-report/';
const dryRunIndex = process.argv.indexOf('--dry-run');
const dryRun = dryRunIndex !== -1;
const sample = process.env.SAMPLE === '1';
const morning = dryRun || process.env.MORNING === '1';
const canEmail = dryRun || Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
const canPush = dryRun || Boolean(process.env.VAPID_PRIVATE_KEY);
const root = new URL('../../', import.meta.url);
const report = JSON.parse(await fs.readFile(new URL('data/report.json', root), 'utf8'));
const today = report.generatedAt.slice(0, 10);
const now = new Date().toISOString().slice(0, 10);

// ---------- The database ----------
// users/<id>          { email, name, emailAlerts, alertEmail, verifiedEmails, pushSubs, settings, ... }
// pending/<id>        { email, token, sentDate, sends }   confirmation we emailed (only this script reads it)
// confirmations/<token>  { at }                             written by the app when the link is tapped

let users; // [{ id, ...the user's record }]
let db = null;
let FieldValue = null;
if (dryRun) {
  users = JSON.parse(await fs.readFile(process.argv[dryRunIndex + 1], 'utf8'));
} else if (sample) {
  users = []; // examples only: the database isn't touched
} else {
  const { initializeApp, cert } = await import('firebase-admin/app');
  const firestore = await import('firebase-admin/firestore');
  initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  db = firestore.getFirestore();
  FieldValue = firestore.FieldValue;
  const snap = await db.collection('users').get();
  users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
const userDoc = (id) => db.collection('users').doc(id);

// ---------- Sending ----------

let transport = null;

// Gmail said no to the login: describe the two secrets without showing them,
// so a typo is easy to spot in the Action's log.
function explainLoginFailure() {
  const user = process.env.GMAIL_USER ?? '';
  const pass = process.env.GMAIL_APP_PASSWORD ?? '';
  const letters = pass.replace(/\s/g, '');
  console.error([
    'Gmail rejected the login. What the secrets look like (values hidden):',
    `  GMAIL_USER: ${user.length} characters, ${/^[^@\s]+@gmail\.com$/i.test(user.trim()) ? 'looks like a Gmail address' : 'does NOT look like name@gmail.com'}${user !== user.trim() ? ', has spaces at the start or end' : ''}`,
    `  GMAIL_APP_PASSWORD: ${letters.length} letters${letters.length === 16 ? ' (right length)' : ' (an app password has 16)'}${pass !== letters ? ', contains spaces' : ''}${/^[a-z]{16}$/.test(letters) ? '' : ', not all lowercase letters'}`,
    'Make a new app password at https://myaccount.google.com/apppasswords while signed in as the GMAIL_USER account.',
  ].join('\n'));
}

async function sendEmail(to, { subject, text, html }) {
  if (dryRun) {
    console.log(`\n=== Email to: ${to}\nSubject: ${subject}\n\n${text}`);
    if (process.env.EMAIL_PREVIEW_DIR) {
      // Save the HTML too, to look at in a browser
      const file = `${process.env.EMAIL_PREVIEW_DIR}/${to.replace(/[^a-z0-9]+/gi, '_')}-${subject.split(':')[0].replace(/\W+/g, '_')}.html`;
      await fs.writeFile(file, html);
    }
    return;
  }
  if (!transport) {
    const nodemailer = (await import('nodemailer')).default;
    transport = nodemailer.createTransport({
      service: 'gmail',
      // (spaces in an app password, as Google shows it, are fine: they're removed)
      auth: { user: process.env.GMAIL_USER.trim(), pass: process.env.GMAIL_APP_PASSWORD.replace(/\s/g, '') },
    });
    try {
      await transport.verify();
    } catch (err) {
      transport = null; // try again for the next email
      if (err.code === 'EAUTH') explainLoginFailure();
      throw err;
    }
  }
  await transport.sendMail({
    from: `"Snow & Surf Report" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    text,
    html,
    // No List-Unsubscribe header: mail apps show it as a one-tap "Unsubscribe" button,
    // and the only page we could point it at (#alerts) needs signing in first. Add it
    // back once there's a real one-tap unsubscribe link.
  });
  await new Promise((r) => setTimeout(r, 1000)); // gentle on Gmail's limits (~500/day)
}

let webpush = null;
// Returns false when the device is gone (app deleted, notifications turned off).
async function sendPush(sub, payload) {
  if (dryRun) {
    console.log(`\n=== Notification to ${sub.device ?? 'a device'}: ${payload.title}\n${payload.body}`);
    return true;
  }
  if (!webpush) {
    webpush = (await import('web-push')).default;
    const contact = process.env.GMAIL_USER ? `mailto:${process.env.GMAIL_USER}` : SITE_URL;
    webpush.setVapidDetails(contact, vapidPublicKey, process.env.VAPID_PRIVATE_KEY);
  }
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(payload), { TTL: 6 * 3600 });
    return true;
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) return false;
    throw err;
  }
}

// ---------- 1. Confirm new email addresses (every run) ----------

const verified = (u) => {
  const want = (u.alertEmail ?? '').toLowerCase();
  return !want || want === (u.email ?? '').toLowerCase() || (u.verifiedEmails ?? []).includes(want);
};

let confirmed = 0;
let confirmSent = 0;
async function confirmAddresses() {
  for (const user of users) {
    if (verified(user)) continue;
    const want = user.alertEmail.toLowerCase();
    if (dryRun) {
      await sendEmail(want, confirmationEmail({ user, link: `${SITE_URL}#confirm/<code>` }));
      continue;
    }
    const pendingRef = db.collection('pending').doc(user.id);
    const pending = (await pendingRef.get()).data();
    if (pending?.email === want) {
      const click = db.collection('confirmations').doc(pending.token);
      if ((await click.get()).exists) {
        await userDoc(user.id).update({ verifiedEmails: FieldValue.arrayUnion(want) });
        user.verifiedEmails = [...(user.verifiedEmails ?? []), want];
        await Promise.all([pendingRef.delete(), click.delete()]);
        confirmed++;
        continue;
      }
      // Already sent: resend at most once a day, and stop after 3 tries
      if (pending.sentDate === now || pending.sends >= 3) continue;
    }
    if (!canEmail) continue;
    const token = pending?.email === want ? pending.token : crypto.randomBytes(24).toString('hex');
    try {
      await sendEmail(want, confirmationEmail({ user, link: `${SITE_URL}#confirm/${token}` }));
      await pendingRef.set({ email: want, token, sentDate: now, sends: (pending?.email === want ? pending.sends ?? 0 : 0) + 1 });
      confirmSent++;
    } catch (err) {
      console.error(`Couldn't send a confirmation email: ${err.message}`);
    }
  }
  // Links nobody's waiting for (old, or never ours): clear them out after 2 days
  if (!dryRun) {
    const old = await db.collection('confirmations').where('at', '<', new Date(Date.now() - 2 * 86400e3)).get();
    await Promise.all(old.docs.map((d) => d.ref.delete()));
  }
}

// ---------- 2. Morning alerts ----------

const dayLabel = new Date(`${today}T12:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });

// Every mountain and beach by id, for the email details
const items = new Map([...report.sections.snow.items, ...report.sections.surf.items].map((x) => [x.id, x]));

// The day's emails for one person: snow and surf separately (only the kinds that matched)
function emailsFor(user, alerts) {
  const settings = { ...DEFAULT_SETTINGS, ...user.settings };
  const profile = user.profile ?? { levels: [], boards: [] };
  // tides: each tide station's highs and lows; skills: the board/level ranges, for "which board"
  const common = { user, items, siteUrl: SITE_URL, dateLabel: dayLabel, tides: report.sections.surf.tideStations ?? {}, skills: report.sections.surf.skills };
  const snow = alerts.filter((a) => a.kind === 'snow');
  const surf = alerts.filter((a) => a.kind === 'surf');
  return [
    snow.length ? snowEmail({ ...common, alerts: snow, lookAhead: settings.snowDays ?? 3 }) : null,
    surf.length ? surfEmail({ ...common, alerts: surf, lookAhead: settings.surfDays ?? 3, profileText: hasProfile(profile) ? profileText(profile, report.sections.surf.skills) : '' }) : null,
  ].filter(Boolean);
}

// One notification per morning: the alert itself, or a count and the first few
function notification(alerts) {
  if (alerts.length === 1) return { title: alerts[0].title, body: alerts[0].detail, hash: alerts[0].hash, tag: `ssr-${today}` };
  const shown = alerts.slice(0, 3).map((a) => a.title);
  if (alerts.length > 3) shown.push(`and ${alerts.length - 3} more`);
  return { title: `${alerts.length} alerts for today`, body: shown.join('\n'), hash: 'alerts', tag: `ssr-${today}` };
}

// ---------- The weekly heartbeat ----------
// So silence is never a mystery: when nothing has matched for a week, a short Friday
// note with the best of the week ahead; and a new subscriber who hasn't had any email
// yet gets a "you're set up, here's what you're watching" note on their first morning.
// Both count as that day's one email (lastSentDate), and look 7 days ahead (the alerts
// themselves keep the 3/5/7 days the person chose).
const daysSince = (date) => (date ? Math.round((Date.parse(`${today}T12:00Z`) - Date.parse(`${date}T12:00Z`)) / 86400e3) : Infinity);
const isFriday = new Date().toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/Los_Angeles' }) === 'Fri';

function watchedFor(user) {
  const profile = user.profile ?? { levels: [], boards: [] };
  const w = watching(report, user.settings ?? {}, profile, user.pins ?? {}, user.rider);
  const skills = report.sections.surf.skills;
  return {
    snow: w.snow,
    surf: w.surf.map(({ item }) => {
      const fits = hasProfile(profile) ? fitDays(item, profile, skills).slice(0, 7).filter((d) => d.fits) : [];
      return { item, best: fits.reduce((m, d) => (d.ft > (m?.ft ?? -1) ? d : m), null) };
    }),
  };
}

async function maybeDigest(user) {
  const firstOne = !user.lastSentDate && !user.lastDigestDate;
  const quietWeek = isFriday && daysSince(user.lastSentDate) >= 7 && daysSince(user.lastDigestDate) >= 6;
  if (!firstOne && !quietWeek) return false;
  const watched = watchedFor(user);
  if (!watched.snow.length && !watched.surf.length) return false; // watching nothing: nothing to say
  const to = verified(user) && user.alertEmail ? user.alertEmail : user.email;
  try {
    await sendEmail(to, digestEmail({ user, watched, siteUrl: SITE_URL, dateLabel: dayLabel, firstOne }));
  } catch (err) {
    console.error(`Couldn't send the weekly note to user ${user.id}: ${err.message}`);
    return false;
  }
  if (!dryRun) await userDoc(user.id).update({ lastSentDate: today, lastDigestDate: today });
  return true;
}

let emailed = 0;
let pushed = 0;
let skipped = 0;
async function morningAlerts() {
  for (const user of users) {
    if (user.lastSentDate === today) { skipped++; continue; } // already sent today
    const wantsEmail = canEmail && user.emailAlerts !== false && Boolean(user.email);
    const devices = canPush ? Object.entries(user.pushSubs ?? {}) : [];
    if (!wantsEmail && !devices.length) { skipped++; continue; }
    const alerts = computeAlerts(report, user.settings ?? {}, user.profile ?? { levels: [], boards: [] }, user.pins ?? {}, user.rider);
    if (!alerts.length) {
      // Nothing matches. Usually nothing is sent, except the weekly heartbeat (email only)
      if (wantsEmail && await maybeDigest(user)) emailed++;
      else skipped++;
      continue;
    }

    let sent = false;
    if (wantsEmail) {
      const to = verified(user) && user.alertEmail ? user.alertEmail : user.email;
      for (const email of emailsFor(user, alerts)) {
        try {
          await sendEmail(to, email);
          emailed++;
          sent = true;
        } catch (err) {
          console.error(`Couldn't email user ${user.id}: ${err.message}`); // keep going for everyone else
        }
      }
    }
    for (const [deviceId, sub] of devices) {
      try {
        if (await sendPush(sub, notification(alerts))) {
          pushed++;
          sent = true;
        } else if (!dryRun) {
          await userDoc(user.id).update({ [`pushSubs.${deviceId}`]: FieldValue.delete() }); // device is gone
        }
      } catch (err) {
        console.error(`Couldn't notify a device of user ${user.id}: ${err.message}`);
      }
    }
    if (sent && !dryRun) await userDoc(user.id).update({ lastSentDate: today });
  }
}

// ---------- Example emails ----------
// The snowiest mountains and the best-rated beaches that suit an intermediate
// longboarder, as if someone had picked them, so both emails always have content.
async function sendSamples() {
  // SAMPLE_TO: where the examples go (defaults to the sending inbox itself)
  const to = process.env.SAMPLE_TO || process.env.GMAIL_USER;
  if (!to && !dryRun) { console.log('No GMAIL_USER secret, so no example emails.'); return; }
  const snowiest = [...report.sections.snow.items].sort((a, b) => snowComing(b, 7) - snowComing(a, 7)).slice(0, 3).map((r) => r.id);
  const profile = { levels: ['intermediate'], boards: ['longboard'] };
  const beaches = [...report.sections.surf.items].sort((a, b) => (b.rating.score ?? 0) - (a.rating.score ?? 0)).map((s) => s.id);
  const settings = { snowScope: 'chosen', snowWatch: snowiest, snowInches: 1, snowDays: 7, surfScope: 'chosen', surfWatch: beaches, surfDays: 5 };
  const alerts = computeAlerts(report, settings, profile, {}, undefined);
  const surfIds = new Set(alerts.filter((a) => a.kind === 'surf').slice(0, 3).map((a) => a.itemId));
  const picked = alerts.filter((a) => a.kind === 'snow' || surfIds.has(a.itemId));
  // A rider based in Los Angeles, so the examples show "Near you" and "Worth the trip"
  const rider = { home: { label: 'Los Angeles', lat: 34.05, lon: -118.24 }, radiusMi: 300 };
  const user = { name: '', settings, profile, rider };
  const examples = [...emailsFor(user, picked), digestEmail({ user, watched: watchedFor(user), siteUrl: SITE_URL, dateLabel: dayLabel, firstOne: false })];
  for (const email of examples) {
    await sendEmail(to ?? 'you@example.com', { ...email, subject: `[SAMPLE] ${email.subject}` });
    console.log(`Sent an example: ${email.subject}`);
  }
}

if (sample) {
  await sendSamples();
  process.exit(0);
}

await confirmAddresses();
console.log(`Email confirmations: ${confirmSent} sent, ${confirmed} confirmed`);
if (morning) {
  await morningAlerts();
  console.log(`Morning alerts: ${emailed} emails, ${pushed} phone/computer notifications, ${skipped} people skipped (nothing matched, already sent today, or alerts off), ${users.length} signed-up people${dryRun ? ' [dry run: nothing actually sent]' : ''}`);
  if (!canEmail) console.log('No Gmail secrets, so no emails.');
  if (!canPush) console.log('No VAPID_PRIVATE_KEY secret, so no phone notifications.');
} else {
  console.log('Not morning (5-11 AM Pacific), so no alerts this run.');
}
