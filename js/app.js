// Snow and Surf Report — reads data/report.json and builds the page.
// Everything here runs in the browser. No data is fetched from the weather APIs
// directly; the GitHub Action already did that and saved the result.
import { drawCharts, formatTime, h, state } from './ui.js';
import { redrawMaps } from './places.js';
import { renderSnow } from './snow.js';
import { renderSurf, updateTideBackground } from './surf.js';
import { refreshBackground, setScene, startBackground } from './background.js';

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

function setupTabs() {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const select = (tab, focus) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    }
    if (focus) tab.focus();
    try { localStorage.setItem(TAB_KEY, tab.id); } catch { /* private mode: fine */ }
    drawCharts(); // charts on a newly shown tab need drawing at their real width
    redrawMaps();
    setScene(...sceneFor(tab.id)); // snow or water in the background
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    // Arrow keys move between tabs (the standard keyboard pattern for tabs)
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (d) select(tabs[(i + d + tabs.length) % tabs.length], true);
    });
  });
  // A link like .../#surf opens that tab; otherwise use the last tab you picked.
  // (#snow/mammoth is a detail-view link, so only the part before "/" picks the tab.)
  let saved = location.hash ? `tab-${location.hash.slice(1).split("/")[0]}` : null;
  try { saved ??= localStorage.getItem(TAB_KEY); } catch { /* ignore */ }
  select(tabs.find((t) => t.id === saved) ?? tabs[0]);

  // Opening a link like #surf/pipeline while on the Snow tab switches tabs too.
  window.addEventListener('hashchange', () => {
    const t = tabs.find((x) => x.id === `tab-${location.hash.slice(1).split('/')[0]}`);
    if (t && t.getAttribute('aria-selected') !== 'true') select(t);
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

// ---------- Start ----------

function loadReport() {
  return fetch('data/report.json', { cache: 'no-cache' }).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
}

async function main() {
  setupThemeToggle();
  startBackground(); // starts with snow; switches once the tabs are set up
  try {
    // index.html already started downloading the report while this code loaded.
    report = await (window.reportDownload ?? loadReport());
    state.report = report;
  } catch (err) {
    document.getElementById('updated').textContent = `Could not load the report (${err.message}).`;
    return;
  }
  renderHeader();
  // Choose the tab first: then the tab you're not looking at skips drawing its
  // charts and map until you switch to it.
  setupTabs();
  renderSnow(report.sections.snow);
  renderSurf(report.sections.surf);
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
