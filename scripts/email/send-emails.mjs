// Alerts by email and phone notification. Run by the GitHub Action after the report is built:
//   node scripts/email/send-emails.mjs              (real: reads Firestore, sends via Gmail + web push)
//   node scripts/email/send-emails.mjs --dry-run sample-users.json
//                                                   (test: prints what it would send, sends nothing)
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
import { computeAlerts, DEFAULT_SETTINGS } from '../../js/alert-rules.js';
import { hasProfile, profileText } from '../../js/fit.js';
import { vapidPublicKey } from '../../js/firebase-config.js';
import { confirmationEmail, snowEmail, surfEmail } from './templates.mjs';

const SITE_URL = process.env.SITE_URL || 'https://billywall732.github.io/snow-surf-report/';
const dryRunIndex = process.argv.indexOf('--dry-run');
const dryRun = dryRunIndex !== -1;
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
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });
  }
  await transport.sendMail({
    from: `"Snow & Surf Report" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    text,
    html,
    // Lets mail apps show an "Unsubscribe" button that opens the alerts page
    headers: { 'List-Unsubscribe': `<${SITE_URL}#alerts>` },
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
  const common = { user, items, siteUrl: SITE_URL, dateLabel: dayLabel };
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
    if (!alerts.length) { skipped++; continue; } // nothing matches: nothing sent

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
