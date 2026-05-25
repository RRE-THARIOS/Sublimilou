import {
  iconChevDown,
  iconClose,
  iconHome,
  iconList,
  iconNext,
  iconPause,
  iconPlay,
  iconPlaylists,
  iconCreate,
  iconPlus,
  iconPrev,
  iconSearch,
  iconShuffle,
} from './icons.js';

function setIcon(el, html) {
  if (el) el.innerHTML = html;
}

function slot(parent, selector = '.ui-icon') {
  return parent?.querySelector(selector) ?? null;
}

function mountPlayPause(btn) {
  if (!btn) return;
  let playEl = btn.querySelector('.ui-icon-play');
  let pauseEl = btn.querySelector('.ui-icon-pause');
  if (!playEl) {
    playEl = document.createElement('span');
    playEl.className = 'ui-icon ui-icon-play';
    btn.appendChild(playEl);
  }
  if (!pauseEl) {
    pauseEl = document.createElement('span');
    pauseEl.className = 'ui-icon ui-icon-pause';
    pauseEl.hidden = true;
    btn.appendChild(pauseEl);
  }
  setIcon(playEl, iconPlay);
  setIcon(pauseEl, iconPause);
}

/** Injecte les icônes du shell (header, tabs, mini/player) depuis icons.js */
export function mountShellIcons() {
  const byId = {
    'open-search': iconSearch,
    'close-search': iconClose,
    'nav-home': iconHome,
    'nav-library': iconList,
    'nav-playlists': iconPlaylists,
    'nav-create': iconCreate,
    'nav-import': iconPlus,
    'mini-prev': iconPrev,
    'mini-next': iconNext,
    'collapse-player': iconChevDown,
    'open-queue': iconList,
    'btn-shuffle': iconShuffle,
    'btn-prev': iconPrev,
    'btn-next': iconNext,
  };

  for (const [id, icon] of Object.entries(byId)) {
    setIcon(slot(document.getElementById(id)), icon);
  }

  mountPlayPause(document.getElementById('mini-play'));
  mountPlayPause(document.getElementById('btn-play'));
}
