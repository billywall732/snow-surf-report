// Morning email alerts. Run by the GitHub Action after the report is built:
//   node scripts/email/send-emails.mjs              (real: reads Firestore, sends via Gmail)
//   node scripts/email/send-emails.mjs --dry-run sample-users.json
//                                                   (test: prints the emails, sends nothing)
//
// For each person who signed in with Google and turned on "Email me a morning
// summary", it works out their alerts with the SAME rules the app uses
// (js/alert-rules.js) and emails them a short summary, only on days something
// matches, and at most once a day.
//
// Real runs need these GitHub secrets (see README "Email alerts"):
//   FIREBASE_SERVICE_ACCOUNT  the service-account key JSON from Firebase
//   GMAIL_USER                the Gmail address emails are sent from
//   GMAIL_APP_PASSWORD        an App Password for that Gmail account
// and the packages firebase-admin + nodemailer (the workflow installs them).
import fs from 'node:fs/promises';
import { computeAlerts } from '../../js/alert-rules.js';

const SITE_URL = process.env.SITE_URL ?? 'https://billywall732.github.io/snow-surf-report/';
const dryRunIndex = process.argv.indexOf('--dry-run');
const dryRun = dryRunIndex !== -1;
const root = new URL('../../', import.meta.url);
const report = JSON.parse(await fs.readFile(new URL('data/report.json', root), 'utf8'));
const today = report.generatedAt.slice(0, 10);

// ---------- Who gets an email? ----------

let users; // [{ id, email, name, emailAlerts, settings, profile, pins, rider, lastSentDate }]
let markSent; // (id) => remember we emailed this person today
let db;
if (dryRun) {
  users = JSON.parse(await fs.readFile(process.argv[dryRunIndex + 1], 'utf8'));
  markSent = async () => {};
} else {
  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  db = getFirestore();
  const snap = await db.collection('users').where('emailAlerts', '==', true).get();
  users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  markSent = (id) => db.collection('users').doc(id).update({ lastSentDate: today });
}

// ---------- The email ----------

const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const dayLabel = new Date(`${today}T12:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });

function buildEmail(user, alerts) {
  const subject = `Snow & Surf: ${alerts.length} alert${alerts.length === 1 ? '' : 's'} for ${dayLabel}`;
  const manage = `${SITE_URL}#alerts`;
  const text = [
    `Good morning${user.name ? `, ${user.name.split(' ')[0]}` : ''}! Here's what matches your alerts today:`,
    '',
    ...alerts.map((a) => `- ${a.title}\n  ${a.detail}\n  ${SITE_URL}#${a.hash}`),
    '',
    `Change your alerts or turn off these emails: ${manage}`,
  ].join('\n');
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:auto;color:#0b0b0b">
  <h2 style="font-family:Georgia,serif;margin:0 0 4px">Snow &amp; Surf Report</h2>
  <p style="color:#52514e;margin:0 0 16px">${escape(dayLabel)}: ${alerts.length} thing${alerts.length === 1 ? '' : 's'} match your alerts</p>
  ${alerts.map((a) => `<a href="${escape(`${SITE_URL}#${a.hash}`)}" style="display:block;text-decoration:none;color:inherit;border:1px solid #e1e0d9;border-left:4px solid ${a.kind === 'snow' ? '#0f8a7e' : '#2a78d6'};border-radius:8px;padding:10px 12px;margin:0 0 8px">
    <strong>${escape(a.title)}</strong><br><span style="color:#52514e;font-size:14px">${escape(a.detail)}</span></a>`).join('\n  ')}
  <p style="color:#6b6a65;font-size:13px;margin-top:20px">You're getting this because you turned on email alerts in the Snow &amp; Surf Report.
  <a href="${escape(manage)}">Change your alerts or turn off these emails</a>.</p>
</div>`;
  return { subject, text, html };
}

// ---------- Send ----------

let transport = null;
async function send(to, email) {
  if (dryRun) {
    console.log(`\n=== To: ${to}\nSubject: ${email.subject}\n\n${email.text}`);
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
    subject: email.subject,
    text: email.text,
    html: email.html,
    // Lets mail apps show an "Unsubscribe" button that opens the alerts page
    headers: { 'List-Unsubscribe': `<${SITE_URL}#alerts>` },
  });
}

let sent = 0;
let skipped = 0;
for (const user of users) {
  if (!user.email || user.emailAlerts === false) { skipped++; continue; }
  if (user.lastSentDate === today) { skipped++; continue; } // already emailed today
  const alerts = computeAlerts(report, user.settings ?? {}, user.profile ?? { levels: [], boards: [] }, user.pins ?? {}, user.rider);
  if (!alerts.length) { skipped++; continue; } // nothing matches: no email
  try {
    await send(user.email, buildEmail(user, alerts));
    await markSent(user.id);
    sent++;
    await new Promise((r) => setTimeout(r, 1000)); // gentle on Gmail's limits (~500/day)
  } catch (err) {
    console.error(`Couldn't email ${user.email}: ${err.message}`); // keep going for everyone else
  }
}
console.log(`\nEmail alerts: ${sent} sent, ${skipped} skipped (nothing matched, already sent today, or emails off), ${users.length} signed-up users${dryRun ? ' [dry run: nothing actually sent]' : ''}`);
