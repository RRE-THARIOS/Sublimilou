import { synthesizeAffirmations } from './api.js';
import { mixSubliminal, DEFAULT_VOICE_GAIN, MAX_BASE_DURATION_SEC } from './mix-subliminal.js';
import { BUNDLED_AUDIOS, generateAudioThumbnail, getTrackThumbnail } from './bundled-audios.js';
import {
  ensureCloudSessionAuto,
  onCloudAuthChange,
} from './supabase.js';
import {
  deletePlaylist,
  deleteTrack,
  getAllPlaylists,
  getAllTracks,
  getSetting,
  savePlaylist,
  saveTrack,
} from './db.js';
import {
  addToQueue,
  cycleRepeat,
  clearSleepTimer,
  enrichState,
  getRepeatIcon,
  getState,
  loadSettings,
  restoreLastSession,
  jumpToQueueIndex,
  playNext,
  playPrevious,
  playQueue,
  playTrack,
  reorderQueueRelative,
  seek,
  setShuffle,
  setSleepTimer,
  subscribe,
  toggle,
} from './player.js';
import {
  iconChevDown,
  iconChevRight,
  iconChevUp,
  iconClose,
  iconCreate,
  iconEdit,
  iconList,
  iconPlay,
  iconPlus,
  iconShuffle,
  iconTimer,
  iconYoutube,
} from './icons.js';
import { mountShellIcons } from './shell-icons.js';
import { mountThemeToggle } from './theme.js';
import { initModal, showConfirm, showMenu, showPrompt } from './modal.js';
import { QUEUE_VISIBLE } from './queue.js';
import {
  applyCreateDraft,
  applyImportDraft,
  clearCreateDraft,
  clearImportDraft,
  collectCreateDraft,
  collectImportDraft,
  persistResumeView,
  readCreateDraft,
  readImportDraft,
  readResumeView,
  writeCreateDraft,
  writeImportDraft,
} from './form-drafts.js';
import {
  clearTagInput,
  dismissAllTagInputs,
  getTagInputTags,
  mountTagInput,
  recordTagUsage,
  setTagInputTags,
} from './tag-input.js';
import { $, $$, escapeHtml, formatDuration, formatTimer, plural, tagToneClass } from './utils.js';

let tracks = [];
let playlists = [];
let activeView = 'home';
let selectedPlaylistId = null;
let filterTag = '';
let searchQuery = '';
let playerSheetOpen = false;
let queuePanelOpen = false;
let headerSearchOpen = false;
let playlistEditMode = false;

let createDraftTimer = 0;
let importDraftTimer = 0;

const SLEEP_TIMER_OPTIONS = [
  { id: '0', label: 'Minuteur désactivé' },
  { id: '15', label: '15 minutes' },
  { id: '30', label: '30 minutes' },
  { id: '60', label: '1 heure' },
  { id: '120', label: '2 heures' },
  { id: '480', label: '8 heures' },
];

const REPEAT_LABELS = {
  off: 'Répétition désactivée',
  loop: 'Répéter ce titre en boucle',
  once: 'Répéter ce titre une fois',
};

function syncRepeatButton(mode) {
  const btn = $('#btn-repeat');
  const icon = $('#repeat-icon');
  if (!btn || !icon) return;
  btn.dataset.mode = mode;
  btn.dataset.active = String(mode !== 'off');
  btn.setAttribute('aria-label', REPEAT_LABELS[mode] || REPEAT_LABELS.off);
  icon.innerHTML = getRepeatIcon(mode);
}

function syncSleepTimerButton(minutes, remainingMs = 0) {
  const btn = $('#sleep-timer-btn');
  const badge = $('#timer-badge');
  if (!btn) return;
  const active = minutes > 0 || remainingMs > 0;
  btn.dataset.minutes = String(minutes);
  btn.dataset.active = String(active);
  const opt = SLEEP_TIMER_OPTIONS.find((o) => o.id === String(minutes));
  btn.setAttribute(
    'aria-label',
    active
      ? `Minuteur actif${remainingMs ? ` · ${formatTimer(remainingMs)}` : opt ? ` · ${opt.label}` : ''}`
      : 'Minuteur de sommeil',
  );
  if (badge) {
    if (remainingMs > 0) {
      badge.textContent = formatTimer(remainingMs);
      badge.classList.remove('hidden');
      badge.setAttribute('aria-hidden', 'false');
    } else if (minutes > 0) {
      badge.textContent = opt?.label.replace('Minuteur désactivé', '') || '';
      badge.classList.toggle('hidden', !badge.textContent);
    } else {
      badge.classList.add('hidden');
      badge.setAttribute('aria-hidden', 'true');
    }
  }
}

export async function initApp() {
  await ensureCloudSessionAuto();
  onCloudAuthChange(() => {
    refreshData()
      .then(() => {
        if (activeView === 'create') return;
        render();
      })
      .catch(() => {});
  });
  mountShellIcons();
  mountThemeToggle();
  await loadSettings();
  await refreshData();
  await restoreLastSession();
  const resumeView = readResumeView();
  if (resumeView) {
    activeView = resumeView;
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === resumeView));
  }
  initModal();
  bindShellEvents();
  bindGlobalDismiss();
  bindFormDraftPersistence();
  render();
  subscribe(onPlayerState);
  registerServiceWorker();
  requestPersistentStorage();
}

async function refreshData() {
  tracks = await getAllTracks();
  playlists = await getAllPlaylists();
}

function bindShellEvents() {
  $$('.tab').forEach((t) =>
    t.addEventListener('click', () => setView(t.dataset.view)),
  );
  $('#go-home')?.addEventListener('click', () => setView('home'));

  $('#expand-player')?.addEventListener('click', () => openPlayerSheet(true));
  $('#collapse-player')?.addEventListener('click', () => openPlayerSheet(false));
  $('#sheet-backdrop')?.addEventListener('click', () => openPlayerSheet(false));

  $('#mini-play')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle();
  });
  $('#btn-play')?.addEventListener('click', toggle);
  $('#mini-prev')?.addEventListener('click', (e) => {
    e.stopPropagation();
    playPrevious();
  });
  $('#btn-prev')?.addEventListener('click', playPrevious);
  $('#mini-next')?.addEventListener('click', (e) => {
    e.stopPropagation();
    playNext(false);
  });
  $('#btn-next')?.addEventListener('click', () => playNext(false));

  $('#btn-shuffle')?.addEventListener('click', async () => {
    const s = getState();
    await setShuffle(!s.shuffle);
    toast(s.shuffle ? 'Aléatoire désactivé' : 'Aléatoire activé');
  });

  $('#btn-repeat')?.addEventListener('click', async () => {
    const mode = await cycleRepeat();
    syncRepeatButton(mode);
    toast(REPEAT_LABELS[mode]);
  });

  $('#sleep-timer-btn')?.addEventListener('click', openSleepTimerMenu);

  const timerIconEl = $('#sleep-timer-icon');
  if (timerIconEl) timerIconEl.innerHTML = iconTimer;
  syncRepeatButton(getState().repeat);
  syncSleepTimerButton(0);

  $('#sheet-progress')?.addEventListener('click', (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    seek((e.clientX - rect.left) / rect.width);
  });

  $('#open-queue')?.addEventListener('click', () => {
    queuePanelOpen = !queuePanelOpen;
    syncQueuePanelUI();
    if (queuePanelOpen) {
      enrichState(getState()).then((s) => renderQueueList(s));
    }
  });

  $('#sheet-add-pl-btn')?.addEventListener('click', () => {
    const trackId = getState().trackId;
    if (trackId) openAddToPlaylistMenu(trackId);
  });

  $('#open-search')?.addEventListener('click', openHeaderSearch);
  $('#close-search')?.addEventListener('click', closeHeaderSearch);
  $('#global-search')?.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    if (activeView === 'home' || activeView === 'library') render();
  });
}

function openHeaderSearch() {
  headerSearchOpen = true;
  $('#header-default')?.classList.add('hidden');
  $('#header-search')?.classList.remove('hidden');
  const input = $('#global-search');
  if (input) {
    input.value = searchQuery;
    requestAnimationFrame(() => input.focus());
  }
  if (activeView !== 'home' && activeView !== 'library') setView('home', { keepSearch: true });
  else render();
}

function closeHeaderSearch(opts = {}) {
  const { keepQuery = false } = opts;
  headerSearchOpen = false;
  $('#header-default')?.classList.remove('hidden');
  $('#header-search')?.classList.add('hidden');
  const input = $('#global-search');
  if (input) {
    input.blur();
    if (!keepQuery) input.value = '';
  }
  if (!keepQuery) {
    searchQuery = '';
    render();
  }
}

function bindGlobalDismiss() {
  const isModalOpen = () => document.body.classList.contains('modal-open');

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (isModalOpen()) return;
    if (playerSheetOpen) openPlayerSheet(false);
    else if (headerSearchOpen) closeHeaderSearch({ keepQuery: true });
  });

  document.addEventListener(
    'pointerdown',
    (e) => {
      if (isModalOpen()) return;
      const t = e.target;
      if (!(t instanceof Element)) return;

      if (playerSheetOpen) {
        const panel = document.querySelector('.sheet-panel');
        if (!panel?.contains(t)) {
          openPlayerSheet(false);
          return;
        }
      }

      if (headerSearchOpen) {
        const searchBar = document.getElementById('header-search');
        if (searchBar && !searchBar.contains(t)) {
          closeHeaderSearch({ keepQuery: true });
        }
      }

      if (!t.closest('.tag-input')) {
        dismissAllTagInputs();
      }

      const active = document.activeElement;
      if (
        active &&
        (active.matches('input') || active.matches('textarea')) &&
        !active.closest('.modal-card')
      ) {
        const keepFocus = active.closest('.tag-input, #header-search, .player-sheet');
        if (keepFocus && keepFocus.contains(t)) return;
        if (active !== t && !active.contains(t)) active.blur();
      }
    },
    true,
  );
}

function syncHeaderSearchUI() {
  if (!headerSearchOpen) return;
  $('#header-default')?.classList.add('hidden');
  $('#header-search')?.classList.remove('hidden');
  const input = $('#global-search');
  if (input && input.value !== searchQuery) input.value = searchQuery;
}

function syncQueuePanelUI() {
  $('#queue-panel')?.classList.toggle('is-collapsed', !queuePanelOpen);
  const btn = $('#open-queue');
  if (btn) {
    btn.setAttribute('aria-expanded', String(queuePanelOpen));
    btn.dataset.active = String(queuePanelOpen);
  }
}

function openPlayerSheet(open) {
  playerSheetOpen = open;
  const sheet = $('#player-sheet');
  sheet?.classList.toggle('hidden', !open);
  sheet?.setAttribute('aria-hidden', String(!open));
  document.body.classList.toggle('sheet-open', open);
  if (open) {
    syncQueuePanelUI();
    enrichState(getState()).then((s) => {
      updateSheetPlayer(s);
      if (queuePanelOpen) renderQueueList(s);
      updateSheetPlaylistPicker(s.trackId);
    });
  }
}

function setView(view, opts = {}) {
  activeView = view;
  persistResumeView(view);
  if (opts.playlistId) selectedPlaylistId = opts.playlistId;
  if (view !== 'playlist-detail') playlistEditMode = false;
  const keepsSearch = opts.keepSearch || view === 'home' || view === 'library';
  if (!keepsSearch) {
    headerSearchOpen = false;
    searchQuery = '';
    $('#header-default')?.classList.remove('hidden');
    $('#header-search')?.classList.add('hidden');
  }
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  render();
  syncHeaderSearchUI();
}

async function openAddToPlaylistMenu(trackId) {
  if (!trackId) return;

  if (!playlists.length) {
    toast('Crée une playlist dans l’onglet Playlists');
    return;
  }

  const available = playlists.filter((p) => !p.trackIds?.includes(trackId));
  const already = playlists.filter((p) => p.trackIds?.includes(trackId));

  if (!available.length) {
    toast('Déjà dans toutes tes playlists');
    return;
  }

  const plId = await showMenu({
    title: 'Ajouter à une playlist',
    message: already.length ? `Déjà dans : ${already.map((p) => p.name).join(', ')}` : '',
    items: available.map((p) => ({ id: p.id, label: p.name })),
  });

  if (!plId) return;
  await handleAddToPlaylist(trackId, plId, { skipRender: true });
  updateSheetPlaylistPicker(trackId);
}

async function openSleepTimerMenu() {
  const current = $('#sleep-timer-btn')?.dataset.minutes || '0';
  const id = await showMenu({
    title: 'Minuteur de sommeil',
    items: SLEEP_TIMER_OPTIONS.map((o) => ({
      ...o,
      hint: o.id === current ? 'Actuel' : '',
    })),
  });
  if (id === null) return;
  const minutes = parseInt(id, 10) || 0;
  setSleepTimer(minutes);
  updateSleepTimerLabel(minutes);
  if (minutes) toast(`Minuteur : ${minutes} min`);
}

function updateSleepTimerLabel(minutes) {
  syncSleepTimerButton(minutes, getState().timerRemaining);
}

function toast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 2200);
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Bonjour';
  if (h < 18) return 'Bon après-midi';
  return 'Bonsoir mon bébé d\'amour';
}

function recentTracks(n = 6) {
  return [...tracks].sort((a, b) => b.createdAt - a.createdAt).slice(0, n);
}

function allTags() {
  const set = new Set();
  tracks.forEach((t) => (t.tags || []).forEach((tag) => set.add(tag)));
  return [...set].sort();
}

/** Recherche globale : titres, tags, noms de playlists et titres dans les playlists */
function searchAll(query = searchQuery) {
  const q = query.trim().toLowerCase();
  if (!q) return { tracks: [], playlists: [] };

  const trackResults = tracks.filter(
    (t) =>
      t.title?.toLowerCase().includes(q) ||
      (t.tags || []).some((tag) => tag.toLowerCase().includes(q)),
  );

  const trackIds = new Set(trackResults.map((t) => t.id));
  const playlistResults = playlists.filter((pl) => {
    if (pl.name?.toLowerCase().includes(q)) return true;
    return playlistTracks(pl).some(
      (t) =>
        t.title?.toLowerCase().includes(q) ||
        (t.tags || []).some((tag) => tag.toLowerCase().includes(q)),
    );
  });

  return { tracks: trackResults, playlists: playlistResults };
}

function filteredTracks() {
  let list = tracks;
  if (selectedPlaylistId && activeView !== 'playlist-detail') {
    const pl = playlists.find((p) => p.id === selectedPlaylistId);
    list = list.filter((t) => pl?.trackIds?.includes(t.id));
  }
  if (filterTag) list = list.filter((t) => (t.tags || []).includes(filterTag));
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    list = list.filter(
      (t) =>
        t.title?.toLowerCase().includes(q) ||
        (t.tags || []).some((tag) => tag.includes(q)),
    );
  }
  return list;
}

function playlistTracks(pl) {
  return (pl?.trackIds || [])
    .map((id) => tracks.find((t) => t.id === id))
    .filter(Boolean);
}

function totalDuration(ids) {
  return ids.reduce((acc, id) => {
    const t = tracks.find((x) => x.id === id);
    return acc + (t?.duration || 0);
  }, 0);
}

async function playAllTracks(shuffle = false) {
  const ids = filteredTracks().map((t) => t.id);
  if (!ids.length) return toast('Aucun titre à lire');
  await playQueue(ids, { shuffle, label: shuffle ? 'Aléatoire' : 'Bibliothèque' });
  toast(shuffle ? 'Lecture aléatoire' : 'Lecture de la bibliothèque');
  openPlayerSheet(true);
}

async function playPlaylist(pl, shuffle = false) {
  const ids = playlistTracks(pl).map((t) => t.id);
  if (!ids.length) return toast('Playlist vide');
  await playQueue(ids, { shuffle, label: pl.name });
  toast(shuffle ? `${pl.name} · aléatoire` : pl.name);
  openPlayerSheet(true);
}

async function onPlayerState(state) {
  const enriched = await enrichState({ ...state });
  updateMiniPlayer(enriched);
  updateSheetPlayer(enriched);
  syncNowPlayingRows(enriched.trackId);
  if (playerSheetOpen && queuePanelOpen) renderQueueList(enriched);
}

/** Met à jour l’indicateur « en lecture » (barres EQ) dans les listes sans tout re-rendre */
function syncNowPlayingRows(trackId) {
  const eqHtml = '<span class="eq-bars"><i></i><i></i><i></i></span>';
  const playHtml = `<span class="ui-icon">${iconPlay}</span>`;

  $$('.track-row').forEach((row) => {
    if (row.classList.contains('pl-edit-row')) return;

    const active = Boolean(trackId && row.dataset.id === trackId);
    row.classList.toggle('is-playing', active);

    const btn = row.querySelector('.row-play');
    if (!btn) return;

    const hasEq = btn.querySelector('.eq-bars');
    if (active && !hasEq) btn.innerHTML = eqHtml;
    else if (!active && hasEq) btn.innerHTML = playHtml;
  });
}

function updateMiniPlayer(state) {
  const bar = $('#mini-player');
  if (!state.track) {
    bar?.classList.add('hidden');
    document.body.classList.remove('has-player');
    return;
  }
  bar?.classList.remove('hidden');
  document.body.classList.add('has-player');
  bar?.classList.toggle('is-playing', state.playing);
  $('#mini-thumb').src = getTrackThumbnail(state.track);
  $('#mini-title').textContent = state.track.title;
  $('#mini-sub').textContent = state.contextLabel || 'En lecture';

  const playIcon = state.playing;
  $$('#mini-play .ui-icon-play').forEach((el) => (el.hidden = playIcon));
  $$('#mini-play .ui-icon-pause').forEach((el) => (el.hidden = !playIcon));
}

function updateSheetPlayer(state) {
  const tagsBlock = $('#sheet-tags-block');
  if (!state.track) {
    tagsBlock?.setAttribute('hidden', '');
    return;
  }
  $('#sheet-thumb').src = getTrackThumbnail(state.track);
  $('#sheet-title').textContent = state.track.title;
  $('#sheet-context').textContent = state.contextLabel || 'En lecture';

  const tagHtml = renderTrackTags(state.track.tags, { variant: 'sheet', max: 12 });
  const tagDisplay = $('#sheet-tags-display');
  if (tagDisplay) tagDisplay.innerHTML = tagHtml;
  if (tagHtml) tagsBlock?.removeAttribute('hidden');
  else tagsBlock?.setAttribute('hidden', '');

  const dur = state.duration || state.track.duration || 0;
  const pct = dur ? (state.currentTime / dur) * 100 : 0;
  $('#sheet-progress-fill').style.width = `${pct}%`;
  $('#sheet-time-cur').textContent = formatDuration(state.currentTime);
  $('#sheet-time-dur').textContent = formatDuration(dur);

  const playIcon = state.playing;
  $$('#btn-play .ui-icon-play, #mini-play .ui-icon-play').forEach((el) => (el.hidden = playIcon));
  $$('#btn-play .ui-icon-pause, #mini-play .ui-icon-pause').forEach((el) => (el.hidden = !playIcon));

  $('#btn-shuffle').dataset.active = String(state.shuffle);
  syncRepeatButton(state.repeat);
  const timerMins = parseInt($('#sleep-timer-btn')?.dataset.minutes || '0', 10);
  syncSleepTimerButton(timerMins, state.timerRemaining);

  updateSheetPlaylistPicker(state.trackId);
  if (playerSheetOpen && queuePanelOpen) renderQueueList(state);
}

function updateSheetPlaylistPicker(trackId) {
  const btn = $('#sheet-add-pl-btn');
  const row = $('#sheet-pl-row');
  if (!btn || !row) return;

  if (!trackId) {
    row.classList.add('hidden');
    return;
  }
  row.classList.remove('hidden');

  if (!playlists.length) {
    btn.disabled = true;
    btn.textContent = 'Crée une playlist d’abord';
    return;
  }

  const available = playlists.filter((p) => !p.trackIds?.includes(trackId));
  btn.disabled = !available.length;
  btn.textContent = available.length
    ? 'Ajouter à une playlist'
    : 'Déjà dans toutes les playlists';
}

function renderQueueList(state) {
  const ul = $('#queue-list');
  const panel = $('#queue-panel');
  if (!ul || !panel) return;

  const q = state.queue || [];
  const idx = Math.max(0, state.queueIndex ?? 0);
  const currentId = q[idx];

  const renderItem = (id, { active = false, slot = 0, absIndex = 0, canUp = false, canDown = false } = {}) => {
    const t = tracks.find((x) => x.id === id);
    if (!t) return '';
    const thumb = `<img class="qi-thumb" src="${escapeHtml(getTrackThumbnail(t))}" alt="" loading="lazy" />`;
    const reorder = active
      ? ''
      : `<div class="queue-item-actions">
          <button type="button" class="queue-move-btn" data-q-up="${slot}" ${canUp ? '' : 'disabled'} aria-label="Monter"><span class="ui-icon">${iconChevUp}</span></button>
          <button type="button" class="queue-move-btn" data-q-down="${slot}" ${canDown ? '' : 'disabled'} aria-label="Descendre"><span class="ui-icon">${iconChevDown}</span></button>
        </div>`;
    return `
      <li
        class="queue-item ${active ? 'active' : ''}"
        data-q="${id}"
        data-abs="${absIndex}"
        data-slot="${slot}"
        ${active ? 'data-queue-jump' : ''}
      >
        ${thumb}
        <span class="qi-num">${active ? '' : String(slot)}</span>
        <div class="qi-body">
          <span class="qi-title">${escapeHtml(t.title)}</span>
          ${renderTrackTags(t.tags, { max: 1, variant: 'queue' })}
        </div>
        <span class="qi-dur">${formatDuration(t.duration)}</span>
        ${reorder}
      </li>`;
  };

  const upcoming = [];
  for (let s = 1; s <= QUEUE_VISIBLE; s++) {
    const abs = idx + s;
    const id = q[abs];
    if (!id) break;
    upcoming.push({ id, slot: s, absIndex: abs });
  }
  const maxSlot = upcoming.length;

  let html = '';
  if (currentId) {
    html += renderItem(currentId, { active: true, slot: 0, absIndex: idx });
  }

  for (const { id, slot, absIndex } of upcoming) {
    html += renderItem(id, {
      slot,
      absIndex,
      canUp: slot > 1,
      canDown: slot < maxSlot,
    });
  }

  if (!html) {
    ul.innerHTML = `<li class="queue-empty">Aucun titre en lecture</li>`;
    return;
  }

  ul.innerHTML = html;

  ul.querySelectorAll('[data-queue-jump]').forEach((li) => {
    li.addEventListener('click', () => jumpToQueueIndex(parseInt(li.dataset.abs, 10)));
  });

  bindQueueArrowReorder(ul);
}

function bindQueueArrowReorder(ul) {
  $$('[data-q-up]', ul).forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const slot = parseInt(b.dataset.qUp, 10);
      if (slot > 1) reorderQueueRelative(slot, slot - 1);
    }),
  );
  $$('[data-q-down]', ul).forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const slot = parseInt(b.dataset.qDown, 10);
      reorderQueueRelative(slot, slot + 1);
    }),
  );
}

function render() {
  const main = $('#main');
  if (!main) return;

  if (activeView === 'home') {
    main.innerHTML = renderHome();
    bindViewEvents();
    return;
  }

  const views = {
    library: renderLibrary,
    playlists: renderPlaylists,
    'playlist-detail': renderPlaylistDetail,
    create: renderCreate,
    import: renderImport,
  };

  main.innerHTML = views[activeView]?.() || '';
  bindViewEvents();
}

function bindViewEvents() {
  const handlers = {
    home: bindHomeEvents,
    library: bindLibraryEvents,
    playlists: bindPlaylistEvents,
    'playlist-detail': bindPlaylistDetailEvents,
    create: bindCreateEvents,
    import: bindImportEvents,
  };
  handlers[activeView]?.();
}

/* ─── HOME ─── */
function renderHome() {
  if (searchQuery.trim()) return renderHomeSearch();

  const recent = recentTracks(5);

  return `
    <div class="home">
      <header class="home-header">
        <p class="hero-greet">${greeting()}</p>
        <h1 class="hero-title">Ton espace <em>Sublimilou</em></h1>
      </header>

      ${tracks.length ? `
        <div class="home-actions">
          <button type="button" class="home-action primary" data-action="play-all">
            <span class="ha-icon ui-icon">${iconPlay}</span>
            <span>Tout écouter</span>
          </button>
          <button type="button" class="home-action" data-action="shuffle-all">
            <span class="ha-icon ui-icon">${iconShuffle}</span>
            <span>Aléatoire</span>
          </button>
          <button type="button" class="home-action" data-action="goto-create">
            <span class="ha-icon ui-icon">${iconPlus}</span>
            <span>Créer</span>
          </button>
        </div>
      ` : `
        <section class="empty-hero card">
          <p>Commence par créer ton premier subliminal.</p>
          <button type="button" class="btn primary full" data-action="goto-create">Créer un subliminal</button>
        </section>
      `}

      ${recent.length ? `
        <section class="section">
          <div class="section-head">
            <h2>Récemment ajoutés</h2>
            <button type="button" class="text-btn" data-goto="library">Tout voir</button>
          </div>
          <div class="h-scroll">${recent.map((t) => renderTrackTile(t)).join('')}</div>
        </section>
      ` : ''}

      ${playlists.length ? `
        <section class="section">
          <div class="section-head">
            <h2>Playlists</h2>
            <button type="button" class="text-btn" data-goto="playlists">Gérer</button>
          </div>
          <div class="pl-grid">${playlists.slice(0, 4).map((p) => renderPlaylistCard(p)).join('')}</div>
        </section>
      ` : ''}
    </div>`;
}

function renderHomeSearch() {
  const q = searchQuery.trim();
  const { tracks: trackResults, playlists: playlistResults } = searchAll(q);
  const total = trackResults.length + playlistResults.length;

  return `
    <div class="home home-search">
      <header class="home-header">
        <h1 class="hero-title">Résultats</h1>
        <p class="hero-greet home-search-meta">${total} ${plural(total, 'résultat', 'résultats')} · « ${escapeHtml(q)} »</p>
      </header>

      ${trackResults.length ? `
        <section class="section">
          <div class="section-head"><h2>Titres</h2></div>
          <div class="track-list">${trackResults.map((t) => renderTrackRow(t)).join('')}</div>
        </section>
      ` : ''}

      ${playlistResults.length ? `
        <section class="section">
          <div class="section-head"><h2>Playlists</h2></div>
          <div class="pl-grid">${playlistResults.map((p) => renderPlaylistCard(p)).join('')}</div>
        </section>
      ` : ''}

      ${!total ? `
        <section class="empty-hero card">
          <p>Aucun résultat pour « ${escapeHtml(q)} ».</p>
          <p class="hint">Essaie un autre mot-clé, un tag ou le nom d'une playlist.</p>
        </section>
      ` : ''}
    </div>`;
}

function renderTrackTile(track) {
  return `
    <button type="button" class="tile" data-play="${track.id}">
      <img src="${getTrackThumbnail(track)}" alt="" loading="lazy" />
      <span class="tile-title">${escapeHtml(track.title)}</span>
      <span class="tile-dur">${formatDuration(track.duration)}</span>
      ${renderTrackTags(track.tags, { max: 1, variant: 'tile' })}
    </button>`;
}

function playlistCoverThumbs(pl, limit = 3) {
  return playlistTracks(pl)
    .slice(0, limit)
    .map((t) => getTrackThumbnail(t))
    .filter(Boolean);
}

/** Collage Spotify : 3 vignettes circulaires superposées */
function renderPlaylistCover(pl, { size = '' } = {}) {
  const thumbs = playlistCoverThumbs(pl, 3);
  const sizeClass = size ? ` pl-cover--${size}` : '';

  if (!thumbs.length) {
    return `<div class="pl-cover${sizeClass}"><span class="pl-cover-placeholder" aria-hidden="true"></span></div>`;
  }

  let stack = '';
  if (thumbs.length === 1) {
    stack = `<img class="pl-cover-img pl-cover-img--solo" src="${escapeHtml(thumbs[0])}" alt="" loading="lazy" />`;
  } else if (thumbs.length === 2) {
    stack = `
      <img class="pl-cover-img pl-cover-img--left" src="${escapeHtml(thumbs[1])}" alt="" loading="lazy" />
      <img class="pl-cover-img pl-cover-img--center" src="${escapeHtml(thumbs[0])}" alt="" loading="lazy" />`;
  } else {
    stack = `
      <img class="pl-cover-img pl-cover-img--left" src="${escapeHtml(thumbs[1])}" alt="" loading="lazy" />
      <img class="pl-cover-img pl-cover-img--center" src="${escapeHtml(thumbs[0])}" alt="" loading="lazy" />
      <img class="pl-cover-img pl-cover-img--right" src="${escapeHtml(thumbs[2])}" alt="" loading="lazy" />`;
  }

  return `<div class="pl-cover${sizeClass}"><div class="pl-cover-stack">${stack}</div></div>`;
}

function renderPlaylistCard(pl, opts = {}) {
  const count = pl.trackIds?.length || 0;
  const dur = formatDuration(totalDuration(pl.trackIds || []));
  const meta = count
    ? `${count} ${plural(count, 'titre', 'titres')}${dur ? ` · ${dur}` : ''}`
    : 'Vide';

  return `
    <article class="pl-card pl-card--pro">
      ${opts.showDelete ? `<button type="button" class="pl-card-del" data-del-pl="${pl.id}" aria-label="Supprimer la playlist"><span class="ui-icon ui-icon--xs">${iconClose}</span></button>` : ''}
      <button type="button" class="pl-card-open" data-open-pl="${pl.id}">
        ${renderPlaylistCover(pl)}
        <h3>${escapeHtml(pl.name)}</h3>
        <p>${meta}</p>
      </button>
      <div class="pl-card-actions">
        <button type="button" class="pl-card-action" data-play-pl="${pl.id}" title="Lire"><span class="ui-icon">${iconPlay}</span><span>Lire</span></button>
        <button type="button" class="pl-card-action ghost" data-shuffle-pl="${pl.id}" title="Aléatoire"><span class="ui-icon">${iconShuffle}</span></button>
      </div>
    </article>`;
}

function bindHomeEvents() {
  if (searchQuery.trim()) {
    const { tracks: trackResults } = searchAll();
    bindTrackRowEvents(trackResults, 'Recherche');
    $$('[data-open-pl]').forEach((b) =>
      b.addEventListener('click', () => setView('playlist-detail', { playlistId: b.dataset.openPl })),
    );
    $$('[data-play-pl]').forEach((b) => {
      const pl = playlists.find((p) => p.id === b.dataset.playPl);
      if (pl) b.addEventListener('click', () => playPlaylist(pl, false));
    });
    $$('[data-shuffle-pl]').forEach((b) => {
      const pl = playlists.find((p) => p.id === b.dataset.shufflePl);
      if (pl) b.addEventListener('click', () => playPlaylist(pl, true));
    });
    return;
  }

  $('[data-action="play-all"]')?.addEventListener('click', () => playAllTracks(false));
  $('[data-action="shuffle-all"]')?.addEventListener('click', () => playAllTracks(true));
  $('[data-action="goto-import"]')?.addEventListener('click', () => setView('create'));
  $('[data-action="goto-create"]')?.addEventListener('click', () => setView('create'));
  $$('[data-goto]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.goto)));
  $$('[data-goto-create]').forEach((b) => b.addEventListener('click', () => setView('create')));
  $$('[data-play]').forEach((b) =>
    b.addEventListener('click', async () => {
      await playTrack(b.dataset.play, 'Bibliothèque', {
        sourceIds: tracks.map((t) => t.id),
      });
      openPlayerSheet(true);
    }),
  );
  $$('[data-open-pl]').forEach((b) =>
    b.addEventListener('click', () => setView('playlist-detail', { playlistId: b.dataset.openPl })),
  );
  $$('[data-play-pl]').forEach((b) => {
    const pl = playlists.find((p) => p.id === b.dataset.playPl);
    if (pl) b.addEventListener('click', () => playPlaylist(pl, false));
  });
  $$('[data-shuffle-pl]').forEach((b) => {
    const pl = playlists.find((p) => p.id === b.dataset.shufflePl);
    if (pl) b.addEventListener('click', () => playPlaylist(pl, true));
  });
}

/* ─── LIBRARY ─── */
function renderLibrary() {
  const tags = allTags();
  const list = filteredTracks();

  return `
    <div class="page">
      <header class="page-header">
        <h1>${searchQuery.trim() ? 'Résultats' : 'Bibliothèque'}</h1>
        <p class="page-sub">${list.length} ${plural(list.length, 'titre', 'titres')}${searchQuery.trim() ? ` · « ${escapeHtml(searchQuery.trim())} »` : ''}</p>
      </header>
      ${tags.length ? `
        <div class="chips">${tags.map((t) => `
          <button type="button" class="chip ${tagToneClass(t)} ${filterTag === t ? 'active' : ''}" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>
        `).join('')}<button type="button" class="chip ${!filterTag ? 'active' : ''}" data-tag="">Tous</button></div>
      ` : ''}
      <div class="lib-actions">
        <button type="button" class="btn sm" data-lib-play>Tout lire</button>
        <button type="button" class="btn sm ghost" data-lib-shuffle>Aléatoire</button>
      </div>
      <div class="track-list">${list.length ? list.map(renderTrackRow).join('') : '<p class="empty-state">Aucun titre. <button type="button" class="text-btn" data-goto-create>Créer</button></p>'}</div>
    </div>`;
}

function renderThumb(track) {
  return `<img class="row-thumb" src="${getTrackThumbnail(track)}" alt="" loading="lazy" />`;
}

/** Pastilles de tags discrètes (liste, lecteur, tuiles, file) */
function renderTrackTags(tags = [], { max = 3, variant = 'row' } = {}) {
  const list = (tags || []).map((t) => String(t).trim()).filter(Boolean);
  if (!list.length) return '';

  const shown = list.slice(0, max);
  const extra = list.length - shown.length;
  const pills = shown
    .map((t) => `<span class="track-tag track-tag--${variant} ${tagToneClass(t)}">${escapeHtml(t)}</span>`)
    .join('');
  const more =
    extra > 0
      ? `<span class="track-tag track-tag--more track-tag--${variant}" aria-label="${extra} tag${extra > 1 ? 's' : ''} de plus">+${extra}</span>`
      : '';

  return `<div class="track-tags track-tags--${variant}" aria-label="Tags">${pills}${more}</div>`;
}

function renderTrackRow(track, opts = {}) {
  const active = getState().trackId === track.id;
  const tagMax = opts.tagMax ?? 2;
  return `
    <article class="track-row ${active ? 'is-playing' : ''}" data-id="${track.id}">
      <button type="button" class="row-play" data-play="${track.id}" aria-label="Lire">
        ${active ? '<span class="eq-bars"><i></i><i></i><i></i></span>' : `<span class="ui-icon">${iconPlay}</span>`}
      </button>
      ${renderThumb(track)}
      <div class="row-body">
        <h3>${escapeHtml(track.title)}</h3>
        <p class="row-meta">${formatDuration(track.duration)}</p>
        ${renderTrackTags(track.tags, { max: tagMax, variant: 'row' })}
      </div>
      <div class="row-menu">
        <button type="button" class="icon-btn xs ghost" data-queue="${track.id}" title="Écouter ensuite"><span class="ui-icon">${iconPlus}</span></button>
        ${playlists.length ? `<button type="button" class="icon-btn xs ghost" data-add-pl="${track.id}" title="Ajouter à une playlist"><span class="ui-icon">${iconList}</span></button>` : ''}
        ${!opts.hidePlaylist ? `<button type="button" class="icon-btn xs ghost" data-del="${track.id}" title="Supprimer"><span class="ui-icon">${iconClose}</span></button>` : ''}
      </div>
    </article>`;
}

function bindLibraryEvents() {
  $$('[data-tag]').forEach((b) =>
    b.addEventListener('click', () => {
      filterTag = b.dataset.tag || '';
      render();
    }),
  );
  $('[data-lib-play]')?.addEventListener('click', () => playAllTracks(false));
  $('[data-lib-shuffle]')?.addEventListener('click', () => playAllTracks(true));
  $('[data-goto-create]')?.addEventListener('click', () => setView('create'));
  bindTrackRowEvents();
}

function bindTrackRowEvents(trackList, queueLabel = 'Bibliothèque') {
  const rows = trackList || filteredTracks();
  const ids = rows.map((t) => t.id);

  $$('[data-play]').forEach((b) =>
    b.addEventListener('click', async () => {
      const idx = ids.indexOf(b.dataset.play);
      await playQueue(ids, { startIndex: idx >= 0 ? idx : 0, label: queueLabel });
      openPlayerSheet(true);
    }),
  );
  $$('[data-queue]').forEach((b) =>
    b.addEventListener('click', async () => {
      await addToQueue(b.dataset.queue);
      toast('Ajouté à la file');
    }),
  );
  $$('[data-del]').forEach((b) =>
    b.addEventListener('click', () => handleDeleteTrack(b.dataset.del)),
  );
  $$('[data-add-pl]').forEach((b) =>
    b.addEventListener('click', () => openAddToPlaylistMenu(b.dataset.addPl)),
  );
}

async function handleAddToPlaylist(trackId, playlistId, opts = {}) {
  const pl = playlists.find((p) => p.id === playlistId);
  if (!pl || pl.trackIds.includes(trackId)) {
    toast('Déjà dans cette playlist');
    return;
  }
  pl.trackIds.push(trackId);
  await savePlaylist(pl);
  await refreshData();
  toast(`Ajouté à ${pl.name}`);
  if (!opts.skipRender) render();
  else updateSheetPlaylistPicker(trackId);
}

/* ─── PLAYLISTS ─── */
function renderPlaylists() {
  const totalTracks = playlists.reduce((acc, pl) => acc + (pl.trackIds?.length || 0), 0);

  return `
    <div class="page page-playlists">
      <header class="page-hero">
        <p class="page-eyebrow">${playlists.length} ${plural(playlists.length, 'playlist', 'playlists')}${totalTracks ? ` · ${totalTracks} titres` : ''}</p>
        <div class="page-hero-row">
          <h1 class="page-hero-title">Playlists</h1>
          <button type="button" class="page-hero-btn" id="new-playlist">
            <span class="page-hero-btn-icon ui-icon ui-icon--xs">${iconPlus}</span>
            <span>Créer</span>
          </button>
        </div>
        <p class="page-hero-sub">Organise tes sessions par thème</p>
      </header>

      ${playlists.length ? `
        <div class="pl-grid pl-grid--page">
          ${playlists.map((pl) => renderPlaylistCard(pl, { showDelete: true })).join('')}
        </div>
      ` : `
        <section class="empty-panel card">
          <p class="empty-panel-title">Aucune playlist pour l'instant</p>
          <p class="hint">Crée une playlist pour regrouper tes subliminaux par thème.</p>
          <button type="button" class="btn primary" id="new-playlist-empty">Créer ma première playlist</button>
        </section>
      `}
    </div>`;
}

function bindPlaylistEvents() {
  $('#new-playlist')?.addEventListener('click', handleCreatePlaylist);
  $('#new-playlist-empty')?.addEventListener('click', handleCreatePlaylist);
  $$('[data-del-pl]').forEach((b) =>
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await showConfirm({
        title: 'Supprimer la playlist ?',
        message: 'Cette action est définitive.',
        confirmLabel: 'Supprimer',
        danger: true,
      });
      if (!ok) return;
      await deletePlaylist(b.dataset.delPl);
      if (selectedPlaylistId === b.dataset.delPl) selectedPlaylistId = null;
      await refreshData();
      render();
      toast('Playlist supprimée');
    }),
  );
  $$('[data-open-pl]').forEach((b) =>
    b.addEventListener('click', () => setView('playlist-detail', { playlistId: b.dataset.openPl })),
  );
  $$('[data-play-pl]').forEach((b) => {
    const pl = playlists.find((p) => p.id === b.dataset.playPl);
    if (pl) b.addEventListener('click', (e) => { e.stopPropagation(); playPlaylist(pl, false); });
  });
  $$('[data-shuffle-pl]').forEach((b) => {
    const pl = playlists.find((p) => p.id === b.dataset.shufflePl);
    if (pl) b.addEventListener('click', (e) => { e.stopPropagation(); playPlaylist(pl, true); });
  });
}

/* ─── PLAYLIST DETAIL ─── */

function renderPlaylistEditRow(track, index, total) {
  return `
    <article class="track-row pl-edit-row" data-id="${track.id}" data-index="${index}">
      <span class="pl-edit-rank" aria-hidden="true">${index + 1}</span>
      ${renderThumb(track)}
      <div class="row-body">
        <h3>${escapeHtml(track.title)}</h3>
        <p class="row-meta">${formatDuration(track.duration)}</p>
      </div>
      <div class="pl-edit-actions" role="group" aria-label="Actions sur le titre">
        <button type="button" class="pl-move-btn" data-move-up="${track.id}" ${index === 0 ? 'disabled' : ''} aria-label="Monter"><span class="ui-icon">${iconChevUp}</span></button>
        <button type="button" class="pl-move-btn" data-move-down="${track.id}" ${index >= total - 1 ? 'disabled' : ''} aria-label="Descendre"><span class="ui-icon">${iconChevDown}</span></button>
        <button type="button" class="pl-remove-btn" data-pl-remove="${track.id}" aria-label="Retirer de la playlist"><span class="ui-icon">${iconClose}</span></button>
      </div>
    </article>`;
}

function renderPlaylistDetail() {
  const pl = playlists.find((p) => p.id === selectedPlaylistId);
  if (!pl) return `<p class="empty-state">Playlist introuvable.</p>`;

  const list = playlistTracks(pl);
  const dur = formatDuration(totalDuration(pl.trackIds || []));
  const editing = playlistEditMode;

  const trackList = list.length
    ? editing
      ? list.map((t, i) => renderPlaylistEditRow(t, i, list.length)).join('')
      : list.map((t) => renderTrackRow(t, { hidePlaylist: true })).join('')
    : '<p class="empty-state">Playlist vide</p>';

  return `
    <div class="page pl-detail ${editing ? 'is-editing' : ''}">
      <div class="pl-detail-top">
        <button type="button" class="back-btn" data-back-playlists">← Playlists</button>
        ${editing ? '<span class="pl-edit-mode-pill">Modification</span>' : '<span class="pl-detail-top-spacer"></span>'}
        <button
          type="button"
          class="pl-edit-toggle ${editing ? 'is-active' : ''}"
          id="pl-edit-toggle"
          aria-pressed="${editing}"
          aria-label="${editing ? 'Terminer la modification' : 'Modifier la playlist'}"
        >
          ${editing ? '<span class="pl-edit-label">Terminer</span>' : `<span class="ui-icon ui-icon--sm" aria-hidden="true">${iconEdit}</span>`}
        </button>
      </div>
      <div class="pl-detail-hero ${editing ? 'pl-detail-hero--edit' : ''}">
        ${editing ? '<span class="pl-edit-hero-badge">Mode édition</span>' : ''}
        ${renderPlaylistCover(pl, { size: 'lg' })}
        ${editing
          ? `<button type="button" class="pl-name-edit" data-rename-pl>
              <span class="pl-name-edit-text">${escapeHtml(pl.name)}</span>
              <span class="pl-name-edit-icon ui-icon ui-icon--xs" aria-hidden="true">${iconEdit}</span>
            </button>
            <p class="pl-name-edit-hint">Appuyer pour renommer</p>`
          : `<h1>${escapeHtml(pl.name)}</h1>`}
        <p class="page-sub">${list.length} ${plural(list.length, 'titre', 'titres')} · ${dur}</p>
        <div class="pl-detail-actions ${editing ? 'is-hidden' : ''}">
          <button type="button" class="btn primary" data-pl-play="${pl.id}">Lire</button>
          <button type="button" class="btn secondary" data-pl-shuffle="${pl.id}">Aléatoire</button>
        </div>
      </div>
      ${editing && list.length ? `
        <div class="pl-edit-section-head">
          <h2>Ordre des titres</h2>
          <p>Flèches pour déplacer · croix pour retirer</p>
        </div>
      ` : ''}
      <div class="track-list pl-detail-tracks ${editing ? 'pl-detail-tracks--edit' : ''}" id="pl-detail-tracks" data-pl-id="${pl.id}">${trackList}</div>
    </div>`;
}

async function persistPlaylist(pl) {
  await savePlaylist(pl);
  await refreshData();
  render();
}

async function movePlaylistTrackByDelta(plId, trackId, delta) {
  const pl = playlists.find((p) => p.id === plId);
  if (!pl) return;
  const ids = [...pl.trackIds];
  const i = ids.indexOf(trackId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  pl.trackIds = ids;
  await persistPlaylist(pl);
}

async function removeTrackFromPlaylist(plId, trackId) {
  const pl = playlists.find((p) => p.id === plId);
  if (!pl) return;
  pl.trackIds = pl.trackIds.filter((id) => id !== trackId);
  await persistPlaylist(pl);
  toast('Retiré de la playlist');
}

async function renamePlaylistById(plId) {
  const pl = playlists.find((p) => p.id === plId);
  if (!pl) return;
  const name = await showPrompt({
    title: 'Renommer la playlist',
    defaultValue: pl.name,
    confirmLabel: 'Enregistrer',
  });
  if (!name) return;
  pl.name = name.trim();
  if (!pl.name) return;
  await persistPlaylist(pl);
  toast('Playlist renommée');
}

function bindPlaylistDetailEvents() {
  $('[data-back-playlists]')?.addEventListener('click', () => setView('playlists'));

  $('#pl-edit-toggle')?.addEventListener('click', () => {
    playlistEditMode = !playlistEditMode;
    render();
  });

  const pl = playlists.find((p) => p.id === selectedPlaylistId);
  if (!pl) return;

  $('[data-rename-pl]')?.addEventListener('click', () => renamePlaylistById(pl.id));

  if (playlistEditMode) {
    $$('[data-pl-remove]').forEach((b) =>
      b.addEventListener('click', async () => {
        const ok = await showConfirm({
          title: 'Retirer ce titre ?',
          message: 'Il restera dans ta bibliothèque.',
          confirmLabel: 'Retirer',
        });
        if (!ok) return;
        await removeTrackFromPlaylist(pl.id, b.dataset.plRemove);
      }),
    );

    $$('[data-move-up]').forEach((b) =>
      b.addEventListener('click', () => movePlaylistTrackByDelta(pl.id, b.dataset.moveUp, -1)),
    );

    $$('[data-move-down]').forEach((b) =>
      b.addEventListener('click', () => movePlaylistTrackByDelta(pl.id, b.dataset.moveDown, 1)),
    );

    return;
  }

  $(`[data-pl-play="${pl.id}"]`)?.addEventListener('click', () => playPlaylist(pl, false));
  $(`[data-pl-shuffle="${pl.id}"]`)?.addEventListener('click', () => playPlaylist(pl, true));
  $$('[data-play]').forEach((b) =>
    b.addEventListener('click', async () => {
      const ids = playlistTracks(pl).map((t) => t.id);
      const idx = ids.indexOf(b.dataset.play);
      await playQueue(ids, { startIndex: idx >= 0 ? idx : 0, label: pl.name });
      openPlayerSheet(true);
    }),
  );
  $$('[data-queue]').forEach((b) =>
    b.addEventListener('click', async () => {
      await addToQueue(b.dataset.queue);
      toast('Ajouté à la file');
    }),
  );
}

/* ─── CRÉER (subliminal custom) ─── */
function parseAffirmationLines(text) {
  return String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function renderCreate() {
  const audioOptions = BUNDLED_AUDIOS.map((a) => {
    const thumb = generateAudioThumbnail(a);
    return `
    <label class="audio-choice ${BUNDLED_AUDIOS.length === 1 ? 'selected' : ''}" data-audio-id="${a.id}">
      <input type="radio" name="create-audio" value="${a.id}" ${BUNDLED_AUDIOS.length === 1 ? 'checked' : ''} required />
      <img class="audio-choice-thumb" src="${thumb}" alt="" />
      <div class="audio-choice-info">
        <span class="audio-choice-title">${escapeHtml(a.title)}</span>
        <span class="audio-choice-desc">${escapeHtml(a.description)}</span>
      </div>
    </label>`;
  }).join('');

  return `
    <div class="page page-create">
      <header class="page-hero">
        <p class="page-eyebrow">Studio</p>
        <h1 class="page-hero-title">Créer</h1>
        <p class="page-hero-sub">Choisis une musique et ajoute tes affirmations</p>
      </header>

      <section class="create-panel card">
        <div class="create-panel-head">
          <span class="create-panel-icon ui-icon">${iconCreate}</span>
          <div>
            <h2>Ton subliminal</h2>
            <p class="hint">1 phrase par ligne · piste max ${MAX_BASE_DURATION_SEC / 60} min</p>
          </div>
        </div>
        <form id="create-form" class="create-form">
          <div class="field">
            <span>Fond musical</span>
            <div class="audio-choices" id="create-audio-choices">
              ${audioOptions}
            </div>
          </div>
          <label class="field">
            <span>Nom (optionnel)</span>
            <input
              id="create-title"
              type="text"
              maxlength="120"
              placeholder="Laisse vide pour garder le titre de la musique"
              autocomplete="off"
            />
          </label>
          <label class="field field-affirmations">
            <span class="field-label-row">
              <span>Affirmations</span>
              <span class="field-badge">1 ligne = 1 phrase</span>
            </span>
            <div class="create-textarea-wrap">
              <textarea
                id="create-affirmations"
                class="create-textarea"
                rows="10"
                placeholder="Je suis calme et confiante&#10;Mon corps se transforme chaque jour&#10;Je mérite le meilleur"
                required
                spellcheck="true"
              ></textarea>
            </div>
            <p class="field-hint">Répétées en boucle, voix imperceptible</p>
          </label>
          <div class="field field-tags">
            <span>Tags (optionnel)</span>
            <div id="create-tags-root"></div>
          </div>
          <button type="submit" class="btn primary full" id="create-submit">Générer mon subliminal</button>
        </form>
        <div class="create-progress-wrap" id="create-progress-wrap" hidden>
          <progress id="create-progress" max="100" value="0"></progress>
        </div>
        <p id="create-status" class="status" aria-live="polite"></p>
      </section>
    </div>`;
}

function scheduleCreateDraftSave() {
  clearTimeout(createDraftTimer);
  createDraftTimer = setTimeout(saveCreateDraftNow, 250);
}

function saveCreateDraftNow() {
  writeCreateDraft(
    collectCreateDraft(() => getTagInputTags('#create-tags-root')),
  );
}

function restoreCreateDraft() {
  applyCreateDraft(readCreateDraft(), (tags) => setTagInputTags('#create-tags-root', tags));
}

function scheduleImportDraftSave() {
  clearTimeout(importDraftTimer);
  importDraftTimer = setTimeout(saveImportDraftNow, 250);
}

function saveImportDraftNow() {
  writeImportDraft(
    collectImportDraft(() => getTagInputTags('#import-tags-root')),
  );
}

function restoreImportDraft() {
  applyImportDraft(readImportDraft(), (tags) => setTagInputTags('#import-tags-root', tags));
}

function bindFormDraftPersistence() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    if (activeView === 'create') saveCreateDraftNow();
  });
  window.addEventListener('pagehide', () => {
    if (activeView === 'create') saveCreateDraftNow();
  });
}

function bindCreateEvents() {
  mountTagInput('#create-tags-root', {
    getAllTags: allTags,
    onChange: scheduleCreateDraftSave,
  });
  restoreCreateDraft();
  $('#create-title')?.addEventListener('input', scheduleCreateDraftSave);
  $('#create-affirmations')?.addEventListener('input', scheduleCreateDraftSave);
  $$('input[name="create-audio"]')?.forEach((r) =>
    r.addEventListener('change', scheduleCreateDraftSave),
  );
  $('#create-form')?.addEventListener('submit', handleCreate);
}

async function handleCreate(e) {
  e.preventDefault();
  const titleInput = $('#create-title');
  const textInput = $('#create-affirmations');
  const selectedAudioId = $('input[name="create-audio"]:checked')?.value;

  const customTitle = titleInput?.value.trim() || '';
  const phrases = parseAffirmationLines(textInput?.value || '');

  if (!phrases.length) {
    $('#create-status').textContent = 'Écris au moins une affirmation (une ligne).';
    return;
  }

  const audioMeta = BUNDLED_AUDIOS.find((a) => a.id === selectedAudioId);
  if (!audioMeta) {
    $('#create-status').textContent = 'Choisis une musique de fond.';
    return;
  }

  const btn = $('#create-submit');
  const progress = $('#create-progress');
  const status = $('#create-status');
  const wrap = $('#create-progress-wrap');

  const setProgress = (pct, msg) => {
    if (progress) progress.value = pct;
    if (status) status.textContent = msg;
  };

  btn.disabled = true;
  wrap?.removeAttribute('hidden');
  if (progress) progress.hidden = false;

  try {
    setProgress(5, `Chargement de la musique…`);
    const res = await fetch(audioMeta.file);
    if (!res.ok) throw new Error('Impossible de charger la musique.');
    const musicBlob = new Blob([await res.arrayBuffer()], { type: audioMeta.mimeType });
    setProgress(20, 'Musique chargée.');

    setProgress(22, 'Synthèse des voix…');
    const { clips } = await synthesizeAffirmations(phrases);

    setProgress(52, 'Mixage (musique + affirmations)…');
    const { blob, duration } = await mixSubliminal(musicBlob, clips, {
      voiceGain: DEFAULT_VOICE_GAIN,
      onProgress: (p) => setProgress(52 + Math.round(p * 44), `Mixage… ${Math.round(p * 100)}%`),
    });

    setProgress(98, 'Enregistrement…');
    const title = customTitle || audioMeta.title || 'Subliminal';
    const tags = getTagInputTags('#create-tags-root');

    await saveTrack({
      id: crypto.randomUUID(),
      title,
      duration: duration || audioMeta.duration,
      thumbnail: generateAudioThumbnail(audioMeta),
      tags,
      affirmations: phrases,
      source: 'create',
      playlistIds: [],
      blob,
      mimeType: blob.type || 'audio/wav',
      createdAt: Date.now(),
    });

    if (tags.length) recordTagUsage(tags);
    await refreshData();
    clearCreateDraft();
    if (titleInput) titleInput.value = '';
    if (textInput) textInput.value = '';
    clearTagInput('#create-tags-root');
    wrap?.setAttribute('hidden', '');
    if (progress) progress.hidden = true;
    toast('Subliminal créé');
    setView('library');
  } catch (err) {
    setProgress(0, err.message || 'Erreur');
    wrap?.setAttribute('hidden', '');
    if (progress) progress.hidden = true;
  } finally {
    btn.disabled = false;
  }
}

/* ─── IMPORT ─── */
function renderImport() {
  return `
    <div class="page page-import">
      <header class="page-hero">
        <p class="page-eyebrow">Bibliothèque</p>
        <h1 class="page-hero-title">Ajouter</h1>
        <p class="page-hero-sub">Importe depuis YouTube</p>
      </header>

      <section class="import-panel import-panel--featured card">
        <div class="import-panel-head">
          <span class="import-panel-icon">${iconYoutube}</span>
          <div>
            <h2>Lien YouTube</h2>
            <p class="hint">Colle le lien (<strong>www</strong>.youtube.com). Wi-Fi conseillé.</p>
          </div>
        </div>
        <form id="import-form" class="import-form">
          <label class="field">
            <span>URL de la vidéo</span>
            <input id="youtube-url" type="url" inputmode="url" placeholder="https://www.youtube.com/watch?v=…" required autocomplete="off" />
          </label>
          <div class="field field-tags">
            <span>Tags</span>
            <div id="import-tags-root"></div>
          </div>
          <button type="submit" class="btn primary full" id="import-submit">Importer le subliminal</button>
        </form>
        <div class="import-progress-wrap" id="import-progress-wrap" hidden>
          <progress id="import-progress" max="100" value="0"></progress>
        </div>
        <p id="import-status" class="status" aria-live="polite"></p>
      </section>
    </div>`;
}

function bindImportEvents() {
  mountTagInput('#import-tags-root', {
    getAllTags: allTags,
    onChange: scheduleImportDraftSave,
  });
  restoreImportDraft();
  $('#youtube-url')?.addEventListener('input', scheduleImportDraftSave);
  $('#import-form')?.addEventListener('submit', handleImport);
}

async function handleImport(e) {
  e.preventDefault();
  const input = $('#youtube-url');
  let url = input.value.trim();
  if (!url) return;

  const normalized = normalizeYoutubeUrl(url);
  if (!normalized) {
    $('#import-status').textContent = 'Lien invalide — vérifie www.youtube.com';
    return;
  }
  if (normalized !== url) input.value = normalized;

  const btn = $('#import-submit');
  const progress = $('#import-progress');
  const status = $('#import-status');

  btn.disabled = true;
  $('#import-progress-wrap')?.removeAttribute('hidden');
  progress.hidden = false;
  status.textContent = 'Analyse du lien…';

  try {
    const meta = await resolveYoutube(normalized);
    status.textContent = `Téléchargement · ${meta.title}`;

    const blob = await downloadAudio(meta, {
      onProgress: (p) => {
        progress.value = p * 100;
        status.textContent = `Téléchargement… ${Math.round(p * 100)}%`;
      },
    });

    const tags = getTagInputTags('#import-tags-root');

    await saveTrack({
      id: crypto.randomUUID(),
      title: meta.title,
      duration: meta.duration,
      thumbnail: meta.thumbnail,
      youtubeUrl: normalized,
      videoId: meta.videoId,
      tags,
      playlistIds: [],
      blob,
      mimeType: blob.type,
      createdAt: Date.now(),
    });

    recordTagUsage(tags);
    await refreshData();
    clearImportDraft();
    input.value = '';
    clearTagInput('#import-tags-root');
    $('#import-progress-wrap')?.setAttribute('hidden', '');
    progress.hidden = true;
    toast('Ajouté à ta bibliothèque');
    setView('library');
  } catch (err) {
    status.textContent = err.message || 'Erreur';
    $('#import-progress-wrap')?.setAttribute('hidden', '');
    progress.hidden = true;
  } finally {
    btn.disabled = false;
  }
}

async function handleDeleteTrack(id) {
  const ok = await showConfirm({
    title: 'Supprimer ce subliminal ?',
    message: 'Le fichier sera retiré de ta bibliothèque.',
    confirmLabel: 'Supprimer',
    danger: true,
  });
  if (!ok) return;
  await deleteTrack(id);
  await refreshData();
  render();
  toast('Supprimé');
}

async function handleCreatePlaylist() {
  const name = await showPrompt({
    title: 'Nouvelle playlist',
    placeholder: 'Ex. Sommeil, Confiance…',
    confirmLabel: 'Créer',
  });
  if (!name) return;
  await savePlaylist({
    id: crypto.randomUUID(),
    name,
    trackIds: [],
    createdAt: Date.now(),
  });
  await refreshData();
  render();
  toast('Playlist créée');
}

async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      await reg.update();
      if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    } catch {
      /* optional */
    }
  }
}

/** Demande au navigateur de ne jamais expulser les données sans action explicite.
 *  Sans ça, iOS/Android peut vider IndexedDB si le stockage est sous pression. */
async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return;
  try {
    const already = await navigator.storage.persisted();
    if (!already) await navigator.storage.persist();
  } catch {
    /* silencieux si refusé */
  }
}
