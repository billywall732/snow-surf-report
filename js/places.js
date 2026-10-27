// The parts the Snow and Surf tabs share: pin your top 4, a searchable and
// filterable list of every place, a detail view, and a map.
//
// Each tab calls createPlacesTab() with a description of what's different
// (its cards, filters, sorts, detail content and map icon). Everything else —
// saving pins, the "replace which pin?" prompt, the list, the dialog and its
// #snow/<id> or #surf/<id> address — lives here once.
//
// Pins and dropdown choices are saved in this browser (localStorage).
import { ratingBar } from './charts.js';
import { createMap, legendIcon } from './map.js';
import { drawCharts, h, rating } from './ui.js';

const MAX_PINS = 4;
const SHORT_LIST = 10; // rows shown before "Show all"
const instances = [];

// Redraw every tab's map (after a resize, or when a tab becomes visible).
export function redrawMaps() {
  for (const t of instances) t.redrawMap();
}

function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

// "Mammoth Lakes, CA"
export const place = (item) => (item.city ? `${item.city}, ${item.region}` : item.region);

/**
 * opts = {
 *   key:        'snow' | 'surf' (address prefix, element ids)
 *   panelId:    id of the tab's <section>
 *   section:    report.sections.snow / .surf
 *   words:      { one: 'mountain', many: 'mountains', mine: 'My mountains', all: 'All mountains', allNote }
 *   pinKey, listKey:  localStorage keys
 *   filters:    [{ id, label, allLabel, options, test(item, value), initial?(), onChange?(value) }]
 *               options: ['West', ...] or [['beginner', 'Beginner'], ...] (value, label)
 *               initial/onChange: let a filter mirror a setting saved elsewhere
 *   sorts:      [{ value, label, compare(a, b) }]   (first one is the default)
 *   searchPlaceholder, matches(item, query)
 *   rowExtras(item)   -> nodes after the place name (e.g. pass tags)
 *   extraControls()   -> extra filter controls shown under the dropdowns (e.g. skill chips)
 *   extraFilter(item) -> false hides an item from the list and fades it on the map
 *   rowStats(item)    -> one line of numbers under the name
 *   card(item, ui)    -> a pinned place's card (ui = { pinButton, detailsButton })
 *   detailPill(item)  -> a pill shown next to the Pin button in the detail view
 *   detailBody(item)  -> nodes for the detail view, after the rating
 *   detailButtons(item) -> extra buttons beside Pin in the detail view (e.g. Notify me)
 *   top()             -> nodes shown above "My …" (e.g. the best-bet card)
 *   afterMine(pinnedIds) -> nodes shown after the pinned cards (e.g. the tide card)
 *   itemClass(item)   -> extra CSS classes for the list row and map icon (e.g. 'pass-ikon')
 *   legend:     [[classes, label], ...] for the map legend (default: place / pinned / open)
 *   mapIcon:    'peak' | 'wave'
 *   mapLabel:   'Ikon and Epic mountains'
 *   onPinsChange(pinnedIds)
 * }
 */
export function createPlacesTab(opts) {
  const { key, section, words } = opts;
  const byId = (id) => section.items.find((x) => x.id === id);
  const known = new Set(section.items.map((x) => x.id));

  let pinned = load(opts.pinKey, section.defaultPinned ?? []).filter((id) => known.has(id)).slice(0, MAX_PINS);
  const defaults = Object.fromEntries(opts.filters.map((f) => [f.id, 'all']));
  let list = { ...defaults, sort: opts.sorts[0].value, ...load(opts.listKey, {}), query: '' };
  let showAll = false;
  let pendingPin = null; // a place waiting to replace a pin (when all 4 are taken)
  let selectedId = null; // the place open in the detail view
  let openedByUs = false; // did this page add the #key/<id> history entry?
  let visibleIds = new Set();
  const filterSelects = {}; // filter id -> its <select>, so setFilter() can change it
  let mapView = null; // built the first time the map scrolls near the screen
  let mapWanted = false;
  const isPinned = (id) => pinned.includes(id);

  const els = {
    pinned: h('div', { class: 'cards' }),
    pinMsg: h('p', { class: 'pin-msg', role: 'status' }),
    count: h('p', { class: 'fine list-count', 'aria-live': 'polite' }),
    list: h('ul', { class: 'resort-list' }),
    more: h('button', { type: 'button', class: 'text-button show-all' }),
    map: h('div', { class: 'map-wrap' }),
    afterMine: h('div'),
  };
  els.more.addEventListener('click', () => { showAll = !showAll; updateList(); });

  const dialog = h('dialog', { id: `${key}-detail`, class: 'detail', 'aria-labelledby': `${key}-detail-title` });
  document.body.append(dialog);

  document.getElementById(opts.panelId).replaceChildren(
    h('div', { class: 'top-grid' }, opts.top?.() ?? []), // side by side on wide screens
    h('section', { 'aria-labelledby': `${key}-h-mine` },
      h('div', { class: 'section-head' },
        h('h2', { id: `${key}-h-mine` }, words.mine),
        h('p', { class: 'fine' }, `Pin up to ${MAX_PINS} with ☆ in the list below.`)),
      els.pinMsg,
      els.pinned),
    els.afterMine,
    h('section', { 'aria-labelledby': `${key}-h-all`, class: 'all-mountains' },
      h('div', { class: 'section-head' },
        h('h2', { id: `${key}-h-all` }, words.all),
        h('p', { class: 'fine' }, words.allNote)),
      listControls(),
      els.count,
      els.list,
      els.more),
    h('section', { 'aria-labelledby': `${key}-h-map`, class: 'map-section' },
      h('div', { class: 'section-head' },
        h('h2', { id: `${key}-h-map` }, 'Map'),
        h('p', { class: 'fine map-legend' },
          (opts.legend ?? [
            ['', `${words.one[0].toUpperCase()}${words.one.slice(1)}`],
            ['is-pinned', 'Pinned'],
            ['is-selected', 'Open in details'],
          ]).map(([cls, text]) => h('span', { class: 'legend-item' }, legendIcon(opts.mapIcon, cls), ` ${text}`)),
          h('span', { class: 'legend-item' }, 'Tap one for details · pinch or + to zoom.'))),
      els.map),
  );

  // The map is far down the page, so don't draw it until it's about to scroll
  // into view. (IntersectionObserver tells us when an element nears the screen.)
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        mapWanted = true;
        io.disconnect();
        redrawMap();
      }
    }, { rootMargin: '600px' });
    io.observe(els.map);
  } else {
    mapWanted = true;
  }

  // ---------- Re-draw ----------
  // Two parts, so typing in the search box doesn't rebuild the pinned cards
  // (and their charts) on every keystroke.

  function update() {
    updatePins();
    updateList();
    drawCharts();
  }

  function updatePins() {
    els.pinned.replaceChildren(...pinned.map((id) => opts.card(byId(id), ui)));
    if (!pinned.length) {
      els.pinned.append(h('p', { class: 'empty' }, `No pinned ${words.many} yet. Use ☆ in the list below to pin up to four.`));
    }
    els.afterMine.replaceChildren(...(opts.afterMine?.(pinned) ?? []));
  }

  function updateList() {
    const rows = filteredSorted();
    const shown = showAll || list.query ? rows : rows.slice(0, SHORT_LIST);
    els.list.replaceChildren(...shown.map(listRow));
    const total = section.items.length;
    els.count.textContent = `Showing ${shown.length} of ${rows.length}${rows.length < total ? ` matches (${total} total)` : ''}`;
    els.more.hidden = rows.length <= SHORT_LIST || Boolean(list.query);
    els.more.textContent = showAll ? 'Show fewer' : `Show all ${rows.length}`;

    visibleIds = new Set(rows.map((x) => x.id));
    redrawMap();
  }

  function redrawMap() {
    if (!mapWanted || document.getElementById(opts.panelId).hidden) return; // drawn when shown
    // Build the map the first time, or again only if its width changed
    // (sizes on the map depend on width); otherwise just update it.
    const width = els.map.clientWidth;
    if (!mapView || Math.abs(mapView.width - width) > 1) {
      mapView = createMap(els.map, { items: section.items, icon: opts.mapIcon, label: opts.mapLabel, width, onSelect: openDetail, classFor: opts.itemClass });
    }
    mapView.update({ pinned: new Set(pinned), selected: selectedId, visible: visibleIds });
  }

  function refresh() {
    update();
    if (dialog.open && selectedId) renderDetail(selectedId);
  }

  // ---------- Pins ----------

  function togglePin(id) {
    const item = byId(id);
    pendingPin = null;
    if (isPinned(id)) {
      pinned = pinned.filter((p) => p !== id);
      els.pinMsg.textContent = `Unpinned ${item.name}.`;
    } else if (pinned.length >= MAX_PINS) {
      // All slots taken: ask which pin to swap out, right where you tapped.
      pendingPin = id;
      els.pinMsg.textContent = `${words.mine} is full. Choose one to replace with ${item.name}.`;
      refresh();
      document.querySelector(`#${opts.panelId} .pin-replace button, #${key}-detail .pin-replace button`)?.focus();
      return;
    } else {
      pinned = [...pinned, id];
      els.pinMsg.textContent = `Pinned ${item.name}.`;
    }
    pinsChanged();
  }

  function replacePin(oldId) {
    const newId = pendingPin;
    pinned = pinned.map((p) => (p === oldId ? newId : p)); // keeps its position
    pendingPin = null;
    els.pinMsg.textContent = `Replaced ${byId(oldId).name} with ${byId(newId).name}.`;
    pinsChanged();
  }

  // Replace all pins at once (e.g. with the pins saved in your account).
  function setPinned(ids) {
    pinned = (ids ?? []).filter((id) => known.has(id)).slice(0, MAX_PINS);
    save(opts.pinKey, pinned);
    refresh();
  }

  function pinsChanged() {
    save(opts.pinKey, pinned);
    opts.onPinsChange?.(pinned);
    api.onPinsChange?.(pinned);
    refresh();
  }

  function replacePrompt(id) {
    const cancel = h('button', { type: 'button', class: 'cancel' }, 'Cancel');
    cancel.addEventListener('click', (e) => {
      e.stopPropagation();
      pendingPin = null;
      els.pinMsg.textContent = '';
      refresh();
    });
    return h('div', { class: 'pin-replace', role: 'group', 'aria-label': `Replace a pinned ${words.one} with ${byId(id).name}` },
      h('p', {}, `${words.mine} is full (${MAX_PINS}). Replace one with ${byId(id).name}?`),
      h('div', { class: 'pin-replace-options' },
        pinned.map((p) => {
          const b = h('button', { type: 'button' }, `Replace ${byId(p).name}`);
          b.addEventListener('click', (e) => { e.stopPropagation(); replacePin(p); });
          return b;
        }),
        cancel));
  }

  function pinButton(item, { withText = false } = {}) {
    const on = isPinned(item.id);
    const b = h('button', {
      type: 'button',
      class: withText ? 'pin-button with-text' : 'pin-button',
      'aria-pressed': String(on),
      'aria-label': withText ? null : `Pin ${item.name}`,
    }, h('span', { 'aria-hidden': 'true' }, on ? '★' : '☆'), withText ? (on ? ' Pinned' : ' Pin') : null);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePin(item.id);
    });
    return b;
  }

  function detailsButton(item) {
    const b = h('button', { type: 'button', class: 'text-button' }, 'Details');
    b.addEventListener('click', () => openDetail(item.id));
    return b;
  }

  const ui = { pinButton, detailsButton, openDetail };

  // ---------- List ----------

  // Change a filter from outside (e.g. the Notifications page changed your level).
  function setFilter(id, value) {
    const sel = filterSelects[id];
    if (!sel) return;
    sel.value = [...sel.options].some((o) => o.value === value) ? value : 'all';
    list[id] = sel.value;
    updateList();
  }

  function listControls() {
    const remember = () => {
      const { query, ...choices } = list;
      save(opts.listKey, choices);
    };
    const search = h('input', { type: 'search', id: `${key}-search`, placeholder: opts.searchPlaceholder, autocomplete: 'off' });
    search.addEventListener('input', () => { list.query = search.value.trim().toLowerCase(); updateList(); });

    const selects = opts.filters.map((f) => {
      const choices = f.options.map((o) => (Array.isArray(o) ? o : [o, o])); // [value, label]
      const sel = h('select', { id: `${key}-${f.id}` },
        h('option', { value: 'all' }, f.allLabel),
        choices.map(([value, label]) => h('option', { value }, label)));
      const start = f.initial ? f.initial() ?? 'all' : list[f.id];
      sel.value = choices.some(([value]) => value === start) ? start : 'all';
      list[f.id] = sel.value;
      sel.addEventListener('change', () => {
        list[f.id] = sel.value;
        remember();
        f.onChange?.(sel.value);
        updateList();
      });
      filterSelects[f.id] = sel;
      return h('label', { class: 'control' }, h('span', {}, f.label), sel);
    });

    const sort = h('select', { id: `${key}-sort` }, opts.sorts.map((s) => h('option', { value: s.value }, s.label)));
    sort.value = opts.sorts.some((s) => s.value === list.sort) ? list.sort : opts.sorts[0].value;
    list.sort = sort.value;
    sort.addEventListener('change', () => { list.sort = sort.value; remember(); updateList(); });

    return [
      h('div', { class: 'list-controls' },
        h('label', { class: 'control grow' }, h('span', {}, 'Search'), search),
        selects,
        h('label', { class: 'control' }, h('span', {}, 'Sort'), sort)),
      opts.extraControls?.(),
    ];
  }

  function filteredSorted() {
    const rows = section.items.filter((x) =>
      opts.filters.every((f) => list[f.id] === 'all' || f.test(x, list[f.id])) &&
      opts.extraFilter?.(x) !== false &&
      (!list.query || opts.matches(x, list.query)));
    const sorter = opts.sorts.find((s) => s.value === list.sort) ?? opts.sorts[0];
    // Every sort ends with A–Z, so ties are in a predictable order.
    return rows.sort((a, b) => sorter.compare(a, b) || a.name.localeCompare(b.name));
  }

  function listRow(item) {
    const score = item.rating.score;
    const main = h('button', {
      type: 'button',
      class: 'row-main',
      'aria-label': `${item.name}, ${place(item)}. ${score ?? 'Not rated'} of 5. ${item.rating.reason}. Open details.`,
    },
      h('span', { class: 'row-title' },
        h('span', { class: 'row-name' }, item.name),
        h('span', { class: 'row-region' }, `${place(item)} · ${item.area ?? ''}`),
        opts.rowExtras?.(item)),
      h('span', { class: 'row-rating' }, ratingBar(score), h('span', { class: 'rating-score' }, score == null ? '–' : `${score}/5`)),
      h('span', { class: 'row-stats' }, opts.rowStats(item)));
    main.addEventListener('click', () => openDetail(item.id));
    return h('li', { class: `resort-row ${opts.itemClass?.(item) ?? ''}${isPinned(item.id) ? ' is-pinned' : ''}` },
      h('div', { class: 'row-line' }, pinButton(item), main),
      pendingPin === item.id ? replacePrompt(item.id) : null);
  }

  // ---------- Detail view ----------

  // Esc key: handle it ourselves so the address is fixed too.
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeDetail();
  });
  // Clicking the dimmed backdrop (outside the panel) closes it too.
  dialog.addEventListener('click', (e) => { if (e.target === dialog) closeDetail(); });

  // Every way of closing comes here. If we added the #key/<id> history entry, go
  // Back (the hashchange handler then closes the panel), so the browser's Back
  // button doesn't reopen it. If you arrived on a shared link, just swap the
  // address to #key without leaving the site.
  function closeDetail() {
    if (location.hash.startsWith(`#${key}/`)) {
      if (openedByUs) {
        openedByUs = false;
        history.back();
        return;
      }
      // (the page you're looking at, which may not be this tab's)
      const page = document.querySelector('main > section:not([hidden])')?.id.replace('panel-', '') ?? key;
      history.replaceState(null, '', `#${page}`);
    }
    hideDetail();
  }

  function hideDetail() {
    selectedId = null;
    if (dialog.open) dialog.close();
    redrawMap();
  }

  function openDetail(id) {
    openedByUs = true;
    location.hash = `${key}/${id}`; // the hashchange handler opens the dialog
  }

  function syncDialogWithHash() {
    const m = location.hash.match(new RegExp(`^#${key}/([\\w-]+)$`));
    const item = m && byId(m[1]);
    if (item) {
      selectedId = item.id;
      renderDetail(item.id);
      if (!dialog.open) dialog.showModal(); // showModal traps focus inside and enables Esc
      drawCharts();
      redrawMap();
    } else if (dialog.open) {
      openedByUs = false;
      hideDetail();
    }
  }

  function renderDetail(id) {
    const item = byId(id);
    const close = h('button', { type: 'button', class: 'close-button', 'aria-label': 'Close details' }, '×');
    close.addEventListener('click', closeDetail);
    const why = item.rating.factors?.length
      ? h('ul', { class: 'factors' }, item.rating.factors.map((f) => h('li', {}, f)))
      : h('p', { class: 'fine' }, 'Starts at 2; nothing today moved it up or down.');

    dialog.replaceChildren(
      h('div', { class: 'detail-head' },
        h('div', {},
          h('p', { class: 'kicker' }, `${place(item)} · ${item.area ?? ''} `, opts.rowExtras?.(item)),
          h('h2', { id: `${key}-detail-title` }, item.name)),
        close),
      h('div', { class: 'detail-body' },
        h('div', { class: 'detail-actions' }, opts.detailPill?.(item) ?? h('span'),
          h('div', { class: 'detail-buttons' }, opts.detailButtons?.(item), pinButton(item, { withText: true }))),
        pendingPin === id ? replacePrompt(id) : null,
        rating(item.rating),
        h('h4', {}, 'Why this rating'),
        why,
        opts.detailBody(item)),
    );
  }

  window.addEventListener('hashchange', syncDialogWithHash);
  update();
  // Arrived on a link like #surf/el-porto (e.g. from an alert email)? Open it once
  // the rest of the page (other tabs, Notifications) has finished setting up.
  setTimeout(syncDialogWithHash, 0);

  const api = { redrawMap, openDetail, pinned: () => [...pinned], refresh, setFilter, refreshList: () => updateList(), setPinned, onPinsChange: null };
  instances.push(api);
  return api;
}
