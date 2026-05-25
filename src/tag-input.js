import { escapeHtml, tagToneClass } from './utils.js';

const RECENT_KEY = 'sublimilou-recent-tags';
const RECENT_DISPLAY = 5;
const instances = new Map();

function loadRecent() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function recordTagUsage(tags) {
  const added = tags.map(normalizeTag).filter(Boolean);
  if (!added.length) return;
  const recent = loadRecent().filter((t) => !added.includes(t));
  localStorage.setItem(RECENT_KEY, JSON.stringify([...added, ...recent].slice(0, 24)));
}

function normalizeTag(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function getRecentForDisplay() {
  return loadRecent().slice(0, RECENT_DISPLAY);
}

/**
 * @param {string | HTMLElement} root
 * @param {{ getAllTags?: () => string[] }} options
 */
export function mountTagInput(root, options = {}) {
  const el = typeof root === 'string' ? document.querySelector(root) : root;
  if (!el) return;

  el.innerHTML = `
    <div class="tag-input">
      <div class="tag-input-chips" data-chips></div>
      <div class="tag-input-combo">
        <input
          type="text"
          class="tag-input-field"
          data-field
          placeholder="Tape un tag…"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
        />
        <ul class="tag-suggest hidden" data-suggest role="listbox"></ul>
      </div>
      <div class="tag-recent" data-recent hidden></div>
    </div>`;

  const state = {
    tags: [],
    chipsEl: el.querySelector('[data-chips]'),
    field: el.querySelector('[data-field]'),
    suggestEl: el.querySelector('[data-suggest]'),
    recentEl: el.querySelector('[data-recent]'),
    getAllTags: options.getAllTags || (() => []),
    onChange: options.onChange || null,
  };
  instances.set(el, state);

  state.field.addEventListener('input', () => renderSuggestions(state));
  state.field.addEventListener('focus', () => {
    renderSuggestions(state);
    renderRecent(state);
  });
  state.field.addEventListener('keydown', (e) => onKeydown(state, e));
  state.field.addEventListener('blur', () => {
    setTimeout(() => hideSuggestions(state), 150);
  });

  renderChips(state);
  renderRecent(state);
}

export function getTagInputTags(root) {
  const el = typeof root === 'string' ? document.querySelector(root) : root;
  return instances.get(el)?.tags.slice() || [];
}

/** Préremplit les chips (ex. lecteur sur un titre existant) */
export function setTagInputTags(root, tags = []) {
  const el = typeof root === 'string' ? document.querySelector(root) : root;
  const state = instances.get(el);
  if (!state) return;
  state.tags = [...new Set((tags || []).map(normalizeTag).filter(Boolean))];
  renderChips(state);
  state.field.value = '';
  hideSuggestions(state);
}

function notifyTagChange(state) {
  state.onChange?.(state.tags.slice());
}

/** Ferme suggestions / récents de tous les champs tags (tap extérieur) */
export function dismissAllTagInputs() {
  instances.forEach((state) => {
    hideSuggestions(state);
    if (state.recentEl && document.activeElement !== state.field) {
      state.recentEl.hidden = true;
    }
  });
}

export function clearTagInput(root) {
  const el = typeof root === 'string' ? document.querySelector(root) : root;
  const state = instances.get(el);
  if (!state) return;
  state.tags = [];
  renderChips(state);
  state.field.value = '';
  hideSuggestions(state);
  renderRecent(state);
}

function knownTags(state) {
  const recent = loadRecent();
  const fromTracks = state.getAllTags() || [];
  const current = state.tags || [];
  return [...new Set([...current, ...recent, ...fromTracks.map(normalizeTag)])]
    .filter(Boolean)
    .sort();
}

function matchTags(allKnown, q) {
  if (!q) return allKnown;
  const prefix = allKnown.filter((t) => t.startsWith(q));
  const contains = allKnown.filter((t) => !t.startsWith(q) && t.includes(q));
  return [...prefix, ...contains];
}

function addTag(state, raw) {
  const tag = normalizeTag(raw);
  if (!tag || state.tags.includes(tag)) return false;
  state.tags.push(tag);
  renderChips(state);
  state.field.value = '';
  hideSuggestions(state);
  renderRecent(state);
  notifyTagChange(state);
  return true;
}

function pickSuggestion(state, tag) {
  const norm = normalizeTag(tag);
  if (!norm) return;
  if (state.tags.includes(norm)) {
    state.field.value = '';
    hideSuggestions(state);
    state.field.focus();
    return;
  }
  addTag(state, norm);
  state.field.focus();
}

function removeTag(state, tag) {
  state.tags = state.tags.filter((t) => t !== tag);
  renderChips(state);
  renderRecent(state);
  notifyTagChange(state);
}

function renderChips(state) {
  if (!state.tags.length) {
    state.chipsEl.innerHTML = '';
    state.chipsEl.hidden = true;
    return;
  }
  state.chipsEl.hidden = false;
  state.chipsEl.innerHTML = state.tags
    .map(
      (t) => `
      <span class="tag-chip ${tagToneClass(t)}">
        <span>${escapeHtml(t)}</span>
        <button type="button" class="tag-chip-remove" data-remove="${escapeHtml(t)}" aria-label="Retirer ${escapeHtml(t)}"></button>
      </span>`,
    )
    .join('');

  state.chipsEl.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', () => removeTag(state, btn.dataset.remove));
  });
}

function renderRecent(state) {
  const recent = getRecentForDisplay().filter((t) => !state.tags.includes(t));
  if (!recent.length) {
    state.recentEl.hidden = true;
    state.recentEl.innerHTML = '';
    return;
  }
  state.recentEl.hidden = false;
  state.recentEl.innerHTML = `
    <span class="tag-recent-label">Récents</span>
    ${recent
      .map(
        (t) =>
          `<button type="button" class="tag-recent-btn ${tagToneClass(t)}" data-pick="${escapeHtml(t)}">${escapeHtml(t)}</button>`,
      )
      .join('')}`;

  state.recentEl.querySelectorAll('[data-pick]').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => {
      addTag(state, btn.dataset.pick);
      state.field.focus();
    });
  });
}

function renderSuggestions(state) {
  const q = normalizeTag(state.field.value);
  const selected = new Set(state.tags);
  const allKnown = knownTags(state);

  const matched = q
    ? matchTags(allKnown, q)
    : allKnown.filter((t) => !selected.has(t));
  const toAdd = matched.filter((t) => !selected.has(t)).slice(0, 8);
  const already = matched.filter((t) => selected.has(t)).slice(0, 3);
  const ordered = [...toAdd, ...already].slice(0, 8);

  const hasExistingMatch = q.length > 0 && matchTags(allKnown, q).length > 0;
  const exactExists = q.length > 0 && allKnown.includes(q);

  const items = [];

  ordered.forEach((t) => {
    const inList = selected.has(t);
    items.push({
      tag: t,
      label: inList ? `${t} · déjà ajouté` : t,
      create: false,
      already: inList,
    });
  });

  if (q && !exactExists && !hasExistingMatch && !selected.has(q)) {
    items.push({ tag: q, label: `Créer « ${q} »`, create: true, already: false });
  }

  if (!items.length) {
    hideSuggestions(state);
    return;
  }

  state.suggestEl.innerHTML = items
    .map(
      (item, i) => `
      <li>
        <button
          type="button"
          class="tag-suggest-item ${item.create ? 'is-create' : ''} ${item.already ? 'is-already-added' : ''}"
          data-tag="${escapeHtml(item.tag)}"
          data-index="${i}"
          role="option"
        >${escapeHtml(item.label)}</button>
      </li>`,
    )
    .join('');

  state.suggestEl.classList.remove('hidden');
  state.activeIndex = 0;
  highlightSuggestion(state);

  state.suggestEl.querySelectorAll('.tag-suggest-item').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => pickSuggestion(state, btn.dataset.tag));
  });
}

function nextSelectableIndex(state, delta) {
  const count = state.suggestEl.querySelectorAll('.tag-suggest-item').length;
  if (!count) return 0;
  return (state.activeIndex + delta + count) % count;
}

function highlightSuggestion(state) {
  state.suggestEl.querySelectorAll('.tag-suggest-item').forEach((btn, i) => {
    btn.classList.toggle('is-active', i === state.activeIndex);
  });
}

function hideSuggestions(state) {
  state.suggestEl.classList.add('hidden');
  state.suggestEl.innerHTML = '';
  state.activeIndex = -1;
}

function pickActiveSuggestion(state) {
  const btn = state.suggestEl.querySelector(`.tag-suggest-item[data-index="${state.activeIndex}"]`);
  if (btn) pickSuggestion(state, btn.dataset.tag);
  else if (state.field.value.trim()) addTag(state, state.field.value);
}

function onKeydown(state, e) {
  const open = !state.suggestEl.classList.contains('hidden');
  const count = state.suggestEl.querySelectorAll('.tag-suggest-item').length;

  if (e.key === 'ArrowDown' && open && count) {
    e.preventDefault();
    state.activeIndex = nextSelectableIndex(state, 1);
    highlightSuggestion(state);
    return;
  }
  if (e.key === 'ArrowUp' && open && count) {
    e.preventDefault();
    state.activeIndex = nextSelectableIndex(state, -1);
    highlightSuggestion(state);
    return;
  }
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    if (open && state.activeIndex >= 0) pickActiveSuggestion(state);
    else addTag(state, state.field.value);
    return;
  }
  if (e.key === 'Backspace' && !state.field.value && state.tags.length) {
    removeTag(state, state.tags[state.tags.length - 1]);
  }
  if (e.key === 'Escape') {
    hideSuggestions(state);
  }
}
