import { resolveYoutube, downloadAudio } from './api.js';
import {
  deletePlaylist,
  deleteTrack,
  getAllPlaylists,
  getAllTracks,
  savePlaylist,
  saveTrack,
} from './db.js';
import {
  clearSleepTimer,
  enrichState,
  loadSettings,
  pause,
  playTrack,
  seek,
  setLoop,
  setSleepTimer,
  subscribe,
  toggle,
} from './player.js';

const $ = (sel, root = document) => root.querySelector(sel);

let tracks = [];
let playlists = [];
let activeView = 'library';
let selectedPlaylistId = null;
let filterTag = '';

export async function initApp() {
  await loadSettings();
  await refreshData();
  render();
  subscribe(async (state) => {
    const enriched = await enrichState({ ...state });
    updatePlayerBar(enriched);
  });
  bindGlobalEvents();
  registerServiceWorker();
}

async function refreshData() {
  tracks = await getAllTracks();
  playlists = await getAllPlaylists();
}

function bindGlobalEvents() {
  $('#nav-library')?.addEventListener('click', () => setView('library'));
  $('#nav-playlists')?.addEventListener('click', () => setView('playlists'));
  $('#nav-import')?.addEventListener('click', () => setView('import'));

  $('#import-form')?.addEventListener('submit', handleImport);
  $('#player-play')?.addEventListener('click', toggle);
  $('#player-loop')?.addEventListener('click', async () => {
    const btn = $('#player-loop');
    const next = btn.dataset.on !== 'true';
    btn.dataset.on = String(next);
    await setLoop(next);
  });
  $('#sleep-timer')?.addEventListener('change', (e) => {
    const v = parseInt(e.target.value, 10);
    setSleepTimer(v || 0);
  });
  $('#progress-bar')?.addEventListener('click', (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    seek((e.clientX - rect.left) / rect.width);
  });
}

function setView(view) {
  activeView = view;
  document.querySelectorAll('.nav-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  render();
}

function formatDuration(sec) {
  if (!sec || !Number.isFinite(sec)) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatTimer(ms) {
  if (!ms) return '';
  const m = Math.ceil(ms / 60000);
  return `${m} min restantes`;
}

function allTags() {
  const set = new Set();
  tracks.forEach((t) => (t.tags || []).forEach((tag) => set.add(tag)));
  return [...set].sort();
}

function filteredTracks() {
  let list = tracks;
  if (selectedPlaylistId) {
    const pl = playlists.find((p) => p.id === selectedPlaylistId);
    list = list.filter((t) => pl?.trackIds?.includes(t.id));
  }
  if (filterTag) list = list.filter((t) => (t.tags || []).includes(filterTag));
  return list;
}

async function handleImport(e) {
  e.preventDefault();
  const input = $('#youtube-url');
  const url = input.value.trim();
  if (!url) return;

  const btn = $('#import-submit');
  const progress = $('#import-progress');
  const status = $('#import-status');

  btn.disabled = true;
  progress.hidden = false;
  status.textContent = 'Analyse du lien…';

  try {
    const meta = await resolveYoutube(url);
    status.textContent = `Téléchargement : ${meta.title}`;

    const blob = await downloadAudio(meta.downloadToken, {
      onProgress: (p) => {
        progress.value = p * 100;
        status.textContent = `Téléchargement… ${Math.round(p * 100)}%`;
      },
    });

    const tagsInput = $('#import-tags');
    const tags = (tagsInput?.value || '')
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    const track = {
      id: crypto.randomUUID(),
      title: meta.title,
      duration: meta.duration,
      thumbnail: meta.thumbnail,
      youtubeUrl: url,
      videoId: meta.videoId,
      tags,
      playlistIds: [],
      blob,
      mimeType: blob.type,
      createdAt: Date.now(),
    };

    await saveTrack(track);
    await refreshData();
    input.value = '';
    if (tagsInput) tagsInput.value = '';
    progress.value = 0;
    progress.hidden = true;
    status.textContent = 'Ajouté à ta bibliothèque ✨';
    setView('library');
  } catch (err) {
    status.textContent = err.message || 'Erreur';
    progress.hidden = true;
  } finally {
    btn.disabled = false;
  }
}

async function handleDeleteTrack(id) {
  if (!confirm('Supprimer ce subliminal ?')) return;
  await deleteTrack(id);
  await refreshData();
  render();
}

async function handleCreatePlaylist() {
  const name = prompt('Nom de la playlist :');
  if (!name?.trim()) return;
  await savePlaylist({
    id: crypto.randomUUID(),
    name: name.trim(),
    trackIds: [],
    createdAt: Date.now(),
  });
  await refreshData();
  render();
}

async function handleAddToPlaylist(trackId, playlistId) {
  const pl = playlists.find((p) => p.id === playlistId);
  if (!pl || pl.trackIds.includes(trackId)) return;
  pl.trackIds.push(trackId);
  await savePlaylist(pl);
  await refreshData();
  render();
}

function updatePlayerBar(state) {
  const bar = $('#player-bar');
  if (!state.trackId || !state.track) {
    bar?.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');
  $('#player-title').textContent = state.track.title;
  $('#player-thumb').src = state.track.thumbnail || '';
  $('#player-play').textContent = state.playing ? '⏸' : '▶';
  $('#player-loop').dataset.on = String(state.loop);

  const dur = state.duration || state.track.duration || 1;
  const pct = (state.currentTime / dur) * 100;
  $('#progress-fill').style.width = `${pct}%`;
  $('#player-time').textContent = `${formatDuration(state.currentTime)} / ${formatDuration(dur)}`;

  const timerEl = $('#timer-remaining');
  if (state.timerRemaining) {
    timerEl.textContent = formatTimer(state.timerRemaining);
    timerEl.hidden = false;
  } else {
    timerEl.hidden = true;
  }
}

function render() {
  const main = $('#main');
  if (!main) return;

  if (activeView === 'import') {
    main.innerHTML = renderImportView();
    $('#import-form')?.addEventListener('submit', handleImport);
    return;
  }

  if (activeView === 'playlists') {
    main.innerHTML = renderPlaylistsView();
    bindPlaylistEvents();
    return;
  }

  main.innerHTML = renderLibraryView();
  bindLibraryEvents();
}

function renderImportView() {
  return `
    <section class="panel import-panel">
      <h2>Ajouter depuis YouTube</h2>
      <p class="hint">Colle le lien, on télécharge l'audio sur ton téléphone. Utilise le Wi‑Fi pour les longues pistes.</p>
      <form id="import-form">
        <label class="field">
          <span>Lien YouTube</span>
          <input id="youtube-url" type="url" placeholder="https://youtube.com/watch?v=…" required />
        </label>
        <label class="field">
          <span>Tags (optionnel, séparés par des virgules)</span>
          <input id="import-tags" type="text" placeholder="sommeil, confiance, 8h" />
        </label>
        <button type="submit" class="btn primary" id="import-submit">Importer</button>
      </form>
      <progress id="import-progress" max="100" value="0" hidden></progress>
      <p id="import-status" class="status" aria-live="polite"></p>
    </section>
  `;
}

function renderLibraryView() {
  const tags = allTags();
  const list = filteredTracks();

  return `
    <section class="panel">
      <div class="panel-head">
        <h2>Ma bibliothèque</h2>
        <span class="badge">${list.length}</span>
      </div>
      ${tags.length ? `
        <div class="tag-filters">
          <button class="tag-chip ${filterTag === '' ? 'active' : ''}" data-tag="">Tous</button>
          ${tags.map((t) => `<button class="tag-chip ${filterTag === t ? 'active' : ''}" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('')}
        </div>
      ` : ''}
      ${selectedPlaylistId ? `<p class="filter-note">Playlist : ${escapeHtml(playlists.find((p) => p.id === selectedPlaylistId)?.name || '')} <button class="link-btn" data-clear-pl>×</button></p>` : ''}
      <div class="track-list">
        ${list.length ? list.map(renderTrackCard).join('') : '<p class="empty">Aucun subliminal. Ajoute-en un ✨</p>'}
      </div>
    </section>
  `;
}

function renderTrackCard(track) {
  const tagHtml = (track.tags || [])
    .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
    .join('');
  return `
    <article class="track-card" data-id="${track.id}">
      <img class="track-thumb" src="${track.thumbnail || ''}" alt="" loading="lazy" />
      <div class="track-info">
        <h3>${escapeHtml(track.title)}</h3>
        <p class="track-meta">${formatDuration(track.duration)} ${tagHtml}</p>
        <div class="track-actions">
          <button class="btn sm play-btn" data-play="${track.id}">▶ Écouter</button>
          <select class="add-pl-select" data-track="${track.id}">
            <option value="">+ Playlist</option>
            ${playlists.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
          </select>
          <button class="btn sm ghost delete-btn" data-del="${track.id}">Suppr.</button>
        </div>
      </div>
    </article>
  `;
}

function renderPlaylistsView() {
  return `
    <section class="panel">
      <div class="panel-head">
        <h2>Playlists</h2>
        <button class="btn sm" id="new-playlist">+ Nouvelle</button>
      </div>
      <div class="playlist-list">
        ${playlists.length ? playlists.map((pl) => `
          <div class="playlist-row">
            <button class="playlist-item" data-pl="${pl.id}">
              <span class="pl-name">${escapeHtml(pl.name)}</span>
              <span class="pl-count">${pl.trackIds?.length || 0} pistes</span>
            </button>
            <button class="btn sm ghost" data-del-pl="${pl.id}">×</button>
          </div>
        `).join('') : '<p class="empty">Crée ta première playlist</p>'}
      </div>
    </section>
  `;
}

function bindLibraryEvents() {
  $('#main').querySelectorAll('[data-tag]').forEach((btn) => {
    btn.addEventListener('click', () => {
      filterTag = btn.dataset.tag || '';
      render();
    });
  });
  $('[data-clear-pl]', $('#main'))?.addEventListener('click', () => {
    selectedPlaylistId = null;
    render();
  });
  $('#main').querySelectorAll('[data-play]').forEach((btn) => {
    btn.addEventListener('click', () => playTrack(btn.dataset.play));
  });
  $('#main').querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleDeleteTrack(btn.dataset.del));
  });
  $('#main').querySelectorAll('.add-pl-select').forEach((sel) => {
    sel.addEventListener('change', () => {
      if (sel.value) handleAddToPlaylist(sel.dataset.track, sel.value);
      sel.value = '';
    });
  });
}

function bindPlaylistEvents() {
  $('#new-playlist')?.addEventListener('click', handleCreatePlaylist);
  $('#main').querySelectorAll('[data-pl]').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedPlaylistId = btn.dataset.pl;
      setView('library');
    });
  });
  $('#main').querySelectorAll('[data-del-pl]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Supprimer cette playlist ?')) return;
      await deletePlaylist(btn.dataset.delPl);
      await refreshData();
      render();
    });
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/sw.js');
    } catch {
      /* offline shell optional */
    }
  }
}
