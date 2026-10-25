// Snow and Surf Report — reads data/report.json and builds the page.
// Everything here runs in the browser. No data is fetched from the weather APIs
// directly; the GitHub Action already did that and saved the result.
import { drawCharts, formatTime, h, state } from './ui.js';
import { redrawMaps } from './places.js';
import { renderSnow } from './snow.js';
import { renderSurf, updateTideBackground } from './surf.js';
import { renderAlerts } from './alerts.js';
import { renderFaq } from './faq.js';
import { renderProfile, setNavigate } from './rider.js';
import { refreshBackground, setMotion, setScene, startBackground } from './background.js';

const TAB_KEY = 'ssr-tab';
let report;

// ---------- Background ----------

// Background settings from the data: heavier snowfall when there's fresh or
// forecast snow, bigger rolling water when the best surf spot has bigger waves.
function sceneFor(tabId) {
  if (tabId === 'tab-surf') {
    const surf = report.sections.surf;
    const best = surf.items.find((s) => s.id === surf.bestBet?.id);
    const ft = best?.waves.data?.heightFt ?? 3;
    return ['surf', { waveScale: Math.max(0.6, Math.min(1.8, ft / 3)) }];
  }
  const inches = Math.max(0, ...report.sections.snow.items.map((r) =>
    (r.observed.data?.newSnow.h48 ?? 0) + (r.forecast.data?.next72hIn ?? 0)));
  return ['snow', { snowIntensity: Math.min(2, 0.7 + inches / 10) }];
}

// ---------- Header, footer, tabs ----------

function renderHeader() {
  const updated = new Date(report.generatedAt);
  document.getElementById('updated').textContent =
    'Updated ' + updated.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

  const ageHours = (Date.now() - updated) / 3_600_000;
  const stale = document.getElementById('stale');
  if (ageHours > 30) {
    stale.textContent = `Heads up: this report is ${Math.round(ageHours / 24)} day(s) old. The morning update may have failed.`;
    stale.hidden = false;
  }
}

// Walk the report and find every block with a source, so the footer can say
// when each source was last fetched and whether anything failed.
function collectBlocks(node, out = []) {
  if (node && typeof node === 'object') {
    if (typeof node.source === 'string' && node.fetchedAt) out.push(node);
    for (const v of Object.values(node)) collectBlocks(v, out);
  }
  return out;
}

function renderSources() {
  const blocks = collectBlocks(report.sections);
  const items = Object.entries(report.sources)
    .filter(([id]) => blocks.some((b) => b.source === id))
    .map(([id, s]) => {
      const mine = blocks.filter((b) => b.source === id);
      const latest = mine.map((b) => b.fetchedAt).sort().at(-1);
      const failed = mine.filter((b) => b.status !== 'ok').length;
      return h('li', {},
        s.url ? h('a', { href: s.url, rel: 'noopener' }, s.name) : s.name,
        ` — fetched ${formatTime(latest)}`,
        failed ? h('span', { class: 'warn' }, ` · ${failed} unavailable`) : null);
    });
  document.getElementById('sources').replaceChildren(
    h('h2', {}, 'Sources'),
    h('ul', {}, items),
    h('p', { class: 'fine' }, 'Season dates and beach directions come from the config file. Ratings are simple rules, not advice — check the resort and the beach before you go.'));
}

// ---------- Pages and the bottom bar ----------
// Five pages: Snow, Surf, Notifications and Profile are tabs in the bottom bar;
// FAQs opens from the "More" menu (which also holds light/dark and animations).
const PAGES = ['snow', 'surf', 'alerts', 'profile', 'faq'];
let showPage = () => {};

function setupPages() {
  const tabs = [...document.querySelectorAll('.bottom-tabs [role="tab"]')];
  const moreButton = document.getElementById('more-button');

  showPage = (name, focus) => {
    if (!PAGES.includes(name)) name = 'snow';
    for (const p of PAGES) document.getElementById(`panel-${p}`).hidden = p !== name;
    for (const t of tabs) {
      const on = t.id === `tab-${name}`;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on || (name === 'faq' && t === tabs[0]) ? 0 : -1;
      if (on && focus) t.focus();
    }
    moreButton.classList.toggle('is-active', name === 'faq'); // FAQs lives under More
    try { localStorage.setItem(TAB_KEY, name); } catch { /* private mode: fine */ }
    // Keep the address in step with the page (#profile, #surf, ...), without adding
    // a Back-button step. Then closing a detail view, which goes Back, lands on the
    // page you were on. (Leave #surf/<id> alone: that's an open detail view.)
    if (!location.hash.includes('/') && location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
    drawCharts(); // charts on a newly shown page need drawing at their real width
    redrawMaps();
    if (name === 'snow' || name === 'surf') setScene(...sceneFor(`tab-${name}`)); // snow or water behind
    if (name === 'faq' || name === 'alerts' || name === 'profile') window.scrollTo(0, 0);
  };

  tabs.forEach((t, i) => {
    t.addEventListener('click', () => showPage(t.id.slice(4)));
    // Arrow keys move between tabs (the standard keyboard pattern for tabs)
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (d) showPage(tabs[(i + d + tabs.length) % tabs.length].id.slice(4), true);
    });
  });

  // A link like .../#surf or .../#faq opens that page; otherwise the last page you used.
  // (#snow/mammoth is a detail-view link, so only the part before "/" picks the page.)
  const fromHash = () => location.hash.slice(1).split('/')[0];
  let start = PAGES.includes(fromHash()) ? fromHash() : null;
  try { start ??= localStorage.getItem(TAB_KEY)?.replace(/^tab-/, ''); } catch { /* ignore */ }
  showPage(start ?? 'snow');

  // A plain page link like #surf switches pages. A detail link like #surf/pipeline
  // only opens that place's detail view on top of whatever page you're on, so
  // closing it leaves you where you were (places.js handles the detail view).
  window.addEventListener('hashchange', () => {
    if (location.hash.includes('/')) return;
    const name = fromHash();
    if (PAGES.includes(name) && document.getElementById(`panel-${name}`).hidden) showPage(name);
  });

  setupMoreMenu();
  setNavigate((name) => showPage(name)); // lets "Open Rider Profile" buttons switch pages
}

// The "More" menu: opens above the bottom bar; closes on a tap outside, Esc, or
// after choosing FAQs. (Light/dark and animations keep it open so you see the change.)
function setupMoreMenu() {
  const button = document.getElementById('more-button');
  const menu = document.getElementById('more-menu');
  const open = (on) => {
    menu.hidden = !on;
    button.setAttribute('aria-expanded', String(on));
    if (on) menu.querySelector('button').focus();
  };
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    open(menu.hidden);
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target)) open(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) {
      open(false);
      button.focus();
    }
  });
  document.getElementById('faq-button').addEventListener('click', () => {
    open(false);
    showPage('faq');
    document.getElementById('panel-faq').focus();
  });
}

// Light/dark toggle: one button that flips between the two. Until you press it,
// the page follows your phone/computer setting; after that, your choice is saved.
// The choice is stored as data-theme on <html>, which the CSS reads.
const THEME_KEY = 'ssr-theme';
const systemDark = matchMedia('(prefers-color-scheme: dark)');
const currentTheme = () => document.documentElement.dataset.theme ?? (systemDark.matches ? 'dark' : 'light');

function setupThemeToggle() {
  const button = document.getElementById('theme-toggle');
  const label = () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    button.querySelector('.theme-icon').textContent = next === 'dark' ? '☾' : '☀';
    button.querySelector('.theme-text').textContent = next === 'dark' ? 'Dark' : 'Light';
    button.setAttribute('aria-label', `Switch to ${next} mode`);
  };
  button.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch { /* private mode: not remembered */ }
    label();
    refreshBackground();
  });
  systemDark.addEventListener('change', label); // (matters until you've pressed the button)
  label();
}

// Animations on/off. Off freezes the background into a still picture. The choice
// is saved; with no saved choice, phones set to "Reduce Motion" start with it off.
const MOTION_KEY = 'ssr-motion';
function setupMotionToggle() {
  const button = document.getElementById('motion-toggle');
  let saved = null;
  try { saved = localStorage.getItem(MOTION_KEY); } catch { /* ignore */ }
  let on = saved ? saved === 'on' : !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const apply = () => {
    setMotion(on);
    // The button says what pressing it will do
    button.querySelector('.motion-icon').textContent = on ? '❚❚' : '▶︎';
    button.querySelector('.motion-text').textContent = on ? 'Animations off' : 'Animations on';
    button.setAttribute('aria-pressed', String(!on)); // pressed = animations are off
  };
  button.addEventListener('click', () => {
    on = !on;
    try { localStorage.setItem(MOTION_KEY, on ? 'on' : 'off'); } catch { /* not remembered */ }
    apply();
  });
  apply();
}

// ---------- Start ----------

function loadReport() {
  return fetch('data/report.json', { cache: 'no-cache' }).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
}

async function main() {
  setupThemeToggle();
  startBackground();
  setupMotionToggle();
  try {
    // index.html already started downloading the report while this code loaded.
    report = await (window.reportDownload ?? loadReport());
    state.report = report;
  } catch (err) {
    document.getElementById('updated').textContent = `Could not load the report (${err.message}).`;
    return;
  }
  renderHeader();
  // Choose the page first: then the pages you're not looking at skip drawing their
  // charts and maps until you switch to them.
  setupPages();
  const snowTab = renderSnow(report.sections.snow);
  const surfTab = renderSurf(report.sections.surf);
  renderAlerts(report, { snow: snowTab, surf: surfTab });
  renderProfile();
  renderFaq();
  renderSources();
  drawCharts();
  redrawMaps();

  // Redraw charts and maps when the WIDTH changes. On phones, scrolling shows and
  // hides the address bar, which fires "resize" with only the height changed;
  // redrawing for that made scrolling lag.
  let timer;
  let lastWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(timer);
    timer = setTimeout(() => { drawCharts(); redrawMaps(); }, 150);
  });
  // Keep the background water in step with the tide if the page stays open.
  setInterval(updateTideBackground, 60_000);
}

main();
