// The landing screen: a video-game style "loading" screen with a Start Shredding
// button. It's part of index.html, so it shows the moment the page opens while the
// report downloads behind it. This file runs the loading bar, the tips and the
// button.
//
// When does it show? Once per visit: the first time the site is opened in a tab
// or browser session (not on every reload). Links straight to a place, like
// #surf/pipeline from an alert email, skip it. The inline script in index.html
// makes that choice before the page draws, so the intro never flashes.
const SEEN_KEY = 'ssr-intro-seen';
const MIN_SHOW_MS = 1600; // long enough to feel like a loading screen, not a flicker

const STATUS = [
  'Waxing boards…',
  'Checking the buoys…',
  'Measuring fresh powder…',
  'Reading the tide charts…',
  'Tuning edges…',
  'Scouting the lineup…',
];
const TIPS = [
  'Longer wave periods (12 s+) mean more powerful waves.',
  'Offshore wind blows from land to sea and cleans up the waves.',
  'Pin your 4 favorite spots with ☆ to keep them on top.',
  'Fresh snow in the last 48 hours = powder day.',
  'Set your Rider Profile for picks made for you.',
  'It’s about 3–5°F colder for every 1,000 ft you climb.',
  'Tap any mountain or beach for the full forecast.',
];

const el = (id) => document.getElementById(id);
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const isShowing = () => document.documentElement.classList.contains('intro-open');

let started = 0;
let progress = 0;
let timers = [];
let ready = false;

function setProgress(p) {
  progress = p;
  el('intro-fill').style.width = `${p}%`;
  el('intro-bar').setAttribute('aria-valuenow', String(Math.round(p)));
}

// Start the bar and the tips. The bar creeps toward 90% on its own; it only jumps
// to 100% when the report has really loaded (introReady).
export function startIntro() {
  wireReplay();
  if (!isShowing()) return;
  started = performance.now();
  ready = false;
  setProgress(0);
  el('intro-start').hidden = true;
  el('intro-quest').hidden = true;
  el('intro-load').hidden = false;
  let i = 0;
  const tip = () => { el('intro-tip').textContent = `TIP: ${TIPS[Math.floor(Math.random() * TIPS.length)]}`; };
  tip();
  el('intro-status').textContent = STATUS[0];
  timers.push(setInterval(() => {
    if (!ready) setProgress(progress + (90 - progress) * 0.08); // slows down as it nears 90
  }, 80));
  timers.push(setInterval(() => {
    if (!ready) el('intro-status').textContent = STATUS[++i % STATUS.length];
  }, 650));
  timers.push(setInterval(tip, 4500));
}

// The report is loaded (or failed): fill the bar, show today's best bets and the button.
export function introReady(report, error) {
  if (!isShowing()) return;
  const wait = Math.max(0, MIN_SHOW_MS - (performance.now() - started));
  setTimeout(() => {
    ready = true;
    setProgress(100);
    el('intro-status').textContent = error ? 'Couldn’t load today’s report' : 'Ready!';
    if (report) showQuest(report);
    setTimeout(() => {
      el('intro-load').hidden = true;
      const button = el('intro-start');
      button.hidden = false;
      button.focus({ preventScroll: true });
    }, reduceMotion() ? 0 : 350);
  }, wait);
}

// "Today's quest": the best bets for snow and surf
function showQuest(report) {
  const card = (icon, label, best) => {
    if (!best) return '';
    const stars = '★'.repeat(best.score ?? 0) + '☆'.repeat(5 - (best.score ?? 0));
    return `<li><span class="intro-quest-icon" aria-hidden="true">${icon}</span>
      <span><span class="intro-quest-label">${label}</span>
      <span class="intro-quest-name">${escapeHTML(best.name)}</span>
      <span class="intro-quest-stars" aria-label="${best.score} out of 5">${stars}</span></span></li>`;
  };
  el('intro-quest-list').innerHTML =
    card('⛰', 'Best snow', report.sections.snow.bestBet) +
    card('🌊', 'Best surf', report.sections.surf.bestBet);
  el('intro-quest').hidden = false;
}

const escapeHTML = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Leave the intro: zoom-and-fade out, then hand the page back.
function enter() {
  if (!isShowing() || el('intro-start').hidden) return;
  try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode: fine */ }
  for (const t of timers) clearInterval(t);
  timers = [];
  const intro = el('intro');
  const done = () => {
    intro.classList.remove('is-leaving');
    document.documentElement.classList.remove('intro-open');
    document.documentElement.classList.add('no-intro');
    // Put keyboard focus on the tab you're on
    document.querySelector('.bottom-tabs [aria-selected="true"]')?.focus({ preventScroll: true });
  };
  if (reduceMotion()) { done(); return; }
  intro.classList.add('is-leaving');
  setTimeout(done, 650);
}

let wired = false;
function wireReplay() {
  if (wired) return;
  wired = true;
  el('intro-start').addEventListener('click', enter);
  // Enter or Space anywhere on the intro starts, like "Press Start"
  document.addEventListener('keydown', (e) => {
    if (isShowing() && (e.key === 'Enter' || e.key === ' ') && !el('intro-start').hidden) {
      e.preventDefault();
      enter();
    }
  });
  // More → Replay intro
  el('replay-intro')?.addEventListener('click', () => {
    document.getElementById('more-menu').hidden = true;
    document.getElementById('more-button').setAttribute('aria-expanded', 'false');
    document.documentElement.classList.remove('no-intro');
    document.documentElement.classList.add('intro-open');
    startIntro();
    introReady(window.ssrReport ?? null);
  });
}
