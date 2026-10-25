// "Does this surf fit me?" — your levels and boards, and the rules that compare
// them with a beach's waves. The rules (wave ranges, wind limits) come from
// config/ratings.json -> surf.skills, copied into the report by the fetch script.
//
// You can pick more than one level and more than one board. A day fits you when it
// suits at least one level you picked with at least one board you picked.
// Your choices are saved in this browser, so the Surf tab and the Notifications
// page always agree.
import { h } from './ui.js';
import * as fit from './fit.js';

const PROFILE_KEY = 'ssr-surfer';
let skills = null; // set by setSkills() once the report has loaded
const listeners = new Set();

export function setSkills(s) {
  skills = s;
}
export const levels = () => Object.entries(skills?.levels ?? {}); // [['beginner', { label, ... }], ...]
export const boards = () => Object.entries(skills?.boards ?? {});

// { levels: ['intermediate', 'advanced'], boards: ['longboard'] }
export function loadProfile() {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY)) ?? {};
    // (Older versions saved one level and one board: { level, board })
    return {
      levels: Array.isArray(p.levels) ? p.levels : p.level ? [p.level] : [],
      boards: Array.isArray(p.boards) ? p.boards : p.board ? [p.board] : [],
    };
  } catch {
    return { levels: [], boards: [] };
  }
}

export function saveProfile(profile) {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch { /* private mode */ }
  for (const fn of listeners) fn(profile);
}

// Tell me when the profile changes (the Surf tab and Notifications page both listen).
// Returns a function that stops listening.
export function onProfileChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// The rules themselves live in fit.js (shared with the morning email script);
// these versions fill in your saved profile and the report's skill thresholds.
export const hasProfile = (p = loadProfile()) => fit.hasProfile(p);
export const profileText = (p = loadProfile()) => fit.profileText(p, skills);
export const fitDay = (spot, day, wind, p = loadProfile()) => fit.fitDay(spot, day, wind, p, skills);
export const fitToday = (spot, p = loadProfile()) => fit.fitToday(spot, p, skills);
export const fitDays = (spot, p = loadProfile()) => fit.fitDays(spot, p, skills);

// ---------- Tap-to-select chips ----------

// Two rows of toggle buttons ("chips"): your levels and your boards. Tap to pick,
// tap again to un-pick; pick as many as you like. Every copy of these chips on the
// page (Surf filters, Notifications) stays in sync through onProfileChange.
export function profileChips({ compact = false } = {}) {
  const wrap = h('div', { class: `skill-chips${compact ? ' compact' : ''}` });
  let drawn = false;
  const draw = () => {
    // Chips that were removed from the page stop listening
    if (drawn && !wrap.isConnected) { stop(); return; }
    drawn = true;
    // Redrawing replaces the buttons: remember which one had keyboard focus
    const buttons = () => [...wrap.querySelectorAll('button')];
    const focused = buttons().indexOf(document.activeElement);
    const p = loadProfile();
    const row = (title, entries, key, describe) => h('div', { class: 'chip-row', role: 'group', 'aria-label': title },
      h('span', { class: 'chip-row-label' }, title),
      h('div', { class: 'chips' }, entries.map(([value, rule]) => {
        const on = p[key].includes(value);
        const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(on) },
          rule.label,
          compact ? null : h('span', { class: 'chip-note' }, describe(rule)));
        b.addEventListener('click', () => {
          const now = loadProfile();
          now[key] = now[key].includes(value) ? now[key].filter((v) => v !== value) : [...now[key], value];
          saveProfile(now); // redraws every set of chips, filters and alerts
        });
        return b;
      })));
    const range = (r) => (r.maxFt >= 40 ? `${r.minFt}+ ft` : `${r.minFt}–${r.maxFt} ft`);
    wrap.replaceChildren(
      row('Your level', levels(), 'levels', range),
      row('Your board', boards(), 'boards', range));
    if (hasProfile(p)) {
      const clear = h('button', { type: 'button', class: 'text-button chip-clear' }, 'Clear');
      clear.addEventListener('click', () => saveProfile({ levels: [], boards: [] }));
      wrap.append(clear);
    }
    if (focused >= 0) (buttons()[focused] ?? buttons().at(-1))?.focus();
  };
  draw();
  const stop = onProfileChange(draw);
  return wrap;
}
