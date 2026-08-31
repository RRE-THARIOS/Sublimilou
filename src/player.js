import { getTrack, getSetting, setSetting } from './db.js';
import { buildQueueFromSource, QUEUE_VISIBLE } from './queue.js';
import { shuffleArray } from './utils.js';

let players = [null, null];
let activePlayer = 0;
let objectUrls = [null, null];
let timerId = null;
let timerEndAt = null;
let currentTrackId = null;
let loopEnabled = false;
let shuffleOn = false;
let repeatMode = 'off'; // off | loop (illimité) | once (1 fois)
let repeatOnceLeft = false;
let queueSource = [];
let queue = [];
let queueIndex = -1;
let listeners = new Set();
let stateContextLabel = '';
let mediaSessionReady = false;
let lastPositionUpdate = 0;
let wasPlayingOnHide = false;
let advancing = false;
let userStopped = false;
let sleepStopped = false;
let watchdogId = null;
let prefetched = { id: null, index: -1 };
let prefetchInFlight = false;
let lastAdvanceAt = 0;
const blobCache = new Map();

function setPlaybackAudioSession() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
  } catch {
    /* Safari */
  }
}

function createAudioEl() {
  const el = new Audio();
  el.preload = 'auto';
  el.setAttribute('playsinline', '');
  el.setAttribute('webkit-playsinline', 'true');
  el.addEventListener('timeupdate', onTimeUpdate);
  el.addEventListener('ended', onEnded);
  el.addEventListener('play', onAudioPlay);
  el.addEventListener('pause', onPause);
  el.addEventListener('loadedmetadata', emit);
  el.addEventListener('error', onAudioError);
  return el;
}

function ensurePlayers() {
  if (!players[0]) {
    players[0] = createAudioEl();
    players[1] = createAudioEl();
    initMediaSessionHandlers();
    bindBackgroundPlaybackGuards();
    startWatchdog();
  }
}

function getAudio() {
  ensurePlayers();
  return players[activePlayer];
}

function getStandby() {
  ensurePlayers();
  return players[1 - activePlayer];
}

function isActiveEl(el) {
  return el === getAudio();
}

function startWatchdog() {
  if (watchdogId) return;
  watchdogId = setInterval(() => {
    const a = players[activePlayer];
    if (!a || advancing || userStopped || sleepStopped) return;
    maybePrefetch();
    if (a.ended || isNearEnd(a)) beginAdvance();
  }, 350);
}

function onTimeUpdate(e) {
  if (e?.target && !isActiveEl(e.target)) return;
  emit();
  updatePositionStateThrottled();
  maybePrefetch();
  maybeAdvanceEarly();
}

function maybeAdvanceEarly() {
  const a = getAudio();
  if (!a || a.paused || advancing || userStopped || sleepStopped) return;
  if (isNearEnd(a, 0.8)) beginAdvance();
}

function onAudioPlay(e) {
  if (e?.target && !isActiveEl(e.target)) return;
  setPlaybackAudioSession();
  emit();
}

function onPause(e) {
  if (e?.target && !isActiveEl(e.target)) return;
  emit();
  if (advancing || userStopped || sleepStopped) return;
  const a = e?.target || getAudio();
  const dur = a?.duration;
  if (!a || !Number.isFinite(dur) || dur <= 0) return;
  if (a.currentTime >= dur - 0.5 && a.currentTime > 0.5) {
    beginAdvance();
  }
}

function onAudioError(e) {
  if (e?.target && !isActiveEl(e.target)) return;
  if (advancing || userStopped || sleepStopped) return;
  if (!currentTrackId || !queueSource.length) return;
  beginAdvance();
}

function bindBackgroundPlaybackGuards() {
  document.addEventListener('visibilitychange', () => {
    const a = getAudio();
    if (!a) return;
    if (document.visibilityState === 'hidden') {
      wasPlayingOnHide = !a.paused && !userStopped && !sleepStopped;
      return;
    }
    resumeAfterBackground();
  });

  window.addEventListener('pagehide', () => {
    const a = players[activePlayer];
    if (a && !a.paused && !userStopped && !sleepStopped) wasPlayingOnHide = true;
  });

  window.addEventListener('pageshow', () => {
    resumeAfterBackground();
  });
}

function resumeAfterBackground() {
  const a = getAudio();
  if (!wasPlayingOnHide || !a || !currentTrackId || userStopped || sleepStopped) {
    wasPlayingOnHide = false;
    return;
  }
  wasPlayingOnHide = false;
  const dur = a.duration;
  const atEnd = Number.isFinite(dur) && dur > 0 && a.currentTime >= dur - 0.5;
  if (a.paused && atEnd) {
    beginAdvance();
    return;
  }
  if (a.paused) a.play().catch(() => {});
}

function buildArtwork(track) {
  const origin = location.origin;
  const items = [
    { src: `${origin}/icon-512.png`, sizes: '512x512', type: 'image/png' },
    { src: `${origin}/icon-192.png`, sizes: '192x192', type: 'image/png' },
    { src: `${origin}/apple-touch-icon.png`, sizes: '180x180', type: 'image/png' },
  ];
  if (track?.thumbnail) {
    const t = track.thumbnail;
    items.unshift(
      { src: t, sizes: '512x512', type: 'image/jpeg' },
      { src: t, sizes: '256x256', type: 'image/jpeg' },
      { src: t, sizes: '128x128', type: 'image/jpeg' },
      { src: t, sizes: '96x96', type: 'image/jpeg' },
    );
  }
  return items;
}

function initMediaSessionHandlers() {
  if (mediaSessionReady || !('mediaSession' in navigator)) return;
  mediaSessionReady = true;

  const safe = (action, fn) => {
    try {
      navigator.mediaSession.setActionHandler(action, fn);
    } catch {
      /* non supporté (ex. seekto sur vieux iOS) */
    }
  };

  safe('play', () => {
    userStopped = false;
    sleepStopped = false;
    getAudio()
      .play()
      .catch(() => {});
  });
  safe('pause', () => pause());
  safe('previoustrack', () => playPrevious());
  safe('nexttrack', () => playNext(false));
  safe('seekbackward', (d) => {
    const skip = d?.seekOffset || 10;
    const a = getAudio();
    seekSeconds(Math.max(0, (a.currentTime || 0) - skip));
  });
  safe('seekforward', (d) => {
    const skip = d?.seekOffset || 10;
    const a = getAudio();
    seekSeconds(Math.min(a.duration || 0, (a.currentTime || 0) + skip));
  });
  safe('seekto', (d) => {
    if (d?.seekTime != null) seekSeconds(d.seekTime);
  });
  safe('stop', null);
}

function updatePositionStateThrottled() {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  const a = getAudio();
  if (!a?.duration || !Number.isFinite(a.duration)) return;

  const now = Date.now();
  if (now - lastPositionUpdate < 900 && !a.paused) return;
  lastPositionUpdate = now;

  try {
    navigator.mediaSession.setPositionState({
      duration: a.duration,
      playbackRate: a.playbackRate || 1,
      position: Math.min(a.currentTime || 0, a.duration),
    });
  } catch {
    /* iOS peut rejeter si métadonnées pas prêtes */
  }
}

function isNearEnd(el, windowSec = 0.5) {
  if (!el) return false;
  if (el.ended) return true;
  const dur = el.duration;
  if (!Number.isFinite(dur) || dur <= 0) return false;
  return el.currentTime >= dur - windowSec && el.currentTime > 0.5;
}

function cacheBlob(id, blob) {
  if (id && blob) blobCache.set(id, blob);
}

function nextQueueIndex() {
  const next = queueIndex + 1;
  ensureQueueLength(next + QUEUE_VISIBLE + 1);
  return next;
}

/**
 * Enchaîne le titre suivant. play() est appelé de façon synchrone
 * (sans await IndexedDB) pour que iOS accepte la lecture.
 */
function beginAdvance() {
  if (advancing || userStopped || sleepStopped) return;
  if (Date.now() - lastAdvanceAt < 700) return;

  const a = getAudio();
  if (repeatMode === 'loop' && currentTrackId) {
    a.currentTime = 0;
    a.play().catch(() => {});
    return;
  }
  if (repeatMode === 'once' && currentTrackId) {
    if (!repeatOnceLeft) {
      repeatOnceLeft = true;
      a.currentTime = 0;
      a.play().catch(() => {});
      return;
    }
    repeatMode = 'off';
    repeatOnceLeft = false;
    loopEnabled = false;
    persistSession().catch(() => {});
    emit();
  }

  const next = nextQueueIndex();
  if (trySyncAdvance(next)) return;

  advancing = true;
  lastAdvanceAt = Date.now();
  playTrackAt(next).finally(() => {
    advancing = false;
  });
}

async function onEnded(e) {
  if (e?.target && !isActiveEl(e.target)) return;
  beginAdvance();
}

function emit() {
  const state = getState();
  listeners.forEach((fn) => fn(state));
  updateMediaSession(state);
}

function updateMediaSession(state) {
  if (!('mediaSession' in navigator)) return;
  initMediaSessionHandlers();

  if (!state.track) {
    navigator.mediaSession.playbackState = 'none';
    try {
      navigator.mediaSession.metadata = null;
    } catch {
      /* ignore */
    }
    return;
  }

  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: state.track.title || 'Subliminal',
      artist: state.contextLabel || 'Sublimilou',
      album: queueSource.length > 1 ? `File · ${queueIndex + 1} / ${queueSource.length}` : 'Sublimilou',
      artwork: buildArtwork(state.track),
    });
  } catch {
    /* MediaMetadata invalide */
  }

  navigator.mediaSession.playbackState = state.playing ? 'playing' : 'paused';
  if (state.playing) updatePositionStateThrottled();
}

function ensureQueueLength(minLen) {
  if (!queueSource.length) return;
  while (queue.length < minLen) {
    queue.push(queueSource[queue.length % queueSource.length]);
  }
}

function initQueue(startIndex) {
  if (!queueSource.length) {
    queue = [];
    queueIndex = -1;
    return;
  }
  queueIndex = Math.min(Math.max(0, startIndex), queueSource.length - 1);
  queue = buildQueueFromSource(queueSource, queueIndex, queueIndex + 1 + QUEUE_VISIBLE);
}

export function subscribe(fn) {
  listeners.add(fn);
  enrichState(getState()).then(fn);
  return () => listeners.delete(fn);
}

export function getState() {
  if (queueSource.length && queueIndex >= 0) {
    ensureQueueLength(queueIndex + 1 + QUEUE_VISIBLE);
  }
  const a = players[activePlayer];
  return {
    trackId: currentTrackId,
    track: null,
    playing: a ? !a.paused : false,
    currentTime: a?.currentTime ?? 0,
    duration: a?.duration || 0,
    loop: loopEnabled,
    shuffle: shuffleOn,
    repeat: repeatMode,
    queue: [...queue],
    queueSource: [...queueSource],
    queueIndex,
    queueUpNext: queue.slice(queueIndex + 1, queueIndex + 1 + QUEUE_VISIBLE),
    timerRemaining: timerEndAt ? Math.max(0, timerEndAt - Date.now()) : 0,
    contextLabel: null,
    hasQueue: queueSource.length > 0,
    canPrev: queueSource.length > 0 && (queueIndex > 0 || (a?.currentTime ?? 0) > 3),
    canNext: queueSource.length > 0,
  };
}

export async function loadSettings() {
  ensurePlayers();
  setPlaybackAudioSession();
  loopEnabled = (await getSetting('loop', 'false')) === 'true';
  shuffleOn = (await getSetting('shuffle', 'false')) === 'true';
  repeatMode = (await getSetting('repeat', 'off')) || 'off';
  if (repeatMode === 'all') repeatMode = 'off';
  if (repeatMode === 'one') repeatMode = 'loop';
  const lastId = await getSetting('lastTrackId', '');
  const lastQueue = await getSetting('lastQueue', '[]');
  const lastSource = await getSetting('lastQueueSource', '[]');
  try {
    const ids = JSON.parse(lastQueue);
    if (Array.isArray(ids) && ids.length) queue = ids;
  } catch {
    queue = [];
  }
  try {
    const src = JSON.parse(lastSource);
    if (Array.isArray(src) && src.length) queueSource = src;
  } catch {
    queueSource = queue.length ? [...queue] : [];
  }
  if (lastId && queue.includes(lastId)) queueIndex = queue.indexOf(lastId);
  else if (queue.length) queueIndex = Math.min(queueIndex, queue.length - 1);
}

export async function restoreLastSession() {
  const lastId = await getSetting('lastTrackId', '');
  if (!lastId || currentTrackId) return;

  const track = await getTrack(lastId);
  if (!track?.blob) return;

  cacheBlob(lastId, track.blob);
  const a = getAudio();
  assignSrc(activePlayer, track.blob);
  currentTrackId = lastId;
  a.load();

  stateContextLabel = 'Reprendre';
  emit();
  prefetchNext();
}

/** Recharge le blob local sans interrompre une lecture en cours. */
export async function reloadCurrentTrackBlob() {
  if (!currentTrackId) return;
  const a = getAudio();
  if (a && !a.paused) return;

  const track = await getTrack(currentTrackId);
  if (!track?.blob) return;

  cacheBlob(currentTrackId, track.blob);

  const t = a?.currentTime || 0;
  assignSrc(activePlayer, track.blob);
  a.load();
  if (t > 0) {
    const onMeta = () => {
      a.currentTime = Math.min(t, a.duration || t);
      a.removeEventListener('loadedmetadata', onMeta);
    };
    a.addEventListener('loadedmetadata', onMeta);
  }
  emit();
}

async function persistSession() {
  await setSetting('lastTrackId', currentTrackId || '');
  await setSetting('lastQueue', JSON.stringify(queue));
  await setSetting('lastQueueSource', JSON.stringify(queueSource));
  await setSetting('shuffle', shuffleOn ? 'true' : 'false');
  await setSetting('repeat', repeatMode);
}

export async function setLoop(enabled) {
  loopEnabled = enabled;
  if (enabled) {
    repeatMode = 'loop';
    repeatOnceLeft = false;
  } else if (repeatMode === 'loop') {
    repeatMode = 'off';
  }
  await setSetting('loop', enabled ? 'true' : 'false');
  await persistSession();
  emit();
}

export async function setShuffle(enabled) {
  shuffleOn = enabled;
  await persistSession();
  emit();
}

export async function cycleRepeat() {
  const order = ['off', 'loop', 'once'];
  const idx = order.indexOf(repeatMode);
  repeatMode = order[((idx >= 0 ? idx : 0) + 1) % order.length];
  loopEnabled = repeatMode === 'loop';
  repeatOnceLeft = false;
  await persistSession();
  emit();
  return repeatMode;
}

function clearStopFlags() {
  userStopped = false;
  sleepStopped = false;
}

export async function playQueue(trackIds, { shuffle = false, startIndex = 0, label = '' } = {}) {
  if (!trackIds.length) return;
  clearStopFlags();
  queueSource = shuffle ? shuffleArray(trackIds) : [...trackIds];
  shuffleOn = shuffle;
  initQueue(startIndex);
  await playTrackAt(queueIndex, label);
}

export async function playTrack(trackId, label = '', { sourceIds = null } = {}) {
  clearStopFlags();
  if (sourceIds?.length) {
    queueSource = [...sourceIds];
    const idx = queueSource.indexOf(trackId);
    initQueue(idx >= 0 ? idx : 0);
  } else if (queueSource.includes(trackId)) {
    initQueue(queueSource.indexOf(trackId));
  } else {
    queueSource = [trackId];
    initQueue(0);
  }
  await playTrackAt(queueIndex, label);
}

export async function addToQueue(trackId) {
  if (!queueSource.includes(trackId)) {
    queueSource.push(trackId);
  }
  ensureQueueLength(queue.length + 1);
  if (!queue.includes(trackId)) {
    queue.push(trackId);
  }
  await persistSession();
  emit();
}

/** Réordonne la file (indices relatifs à la piste en cours, 1 = premier « à suivre ») */
export async function reorderQueueRelative(fromSlot, toSlot) {
  if (fromSlot === toSlot) return;
  const fromAbs = queueIndex + fromSlot;
  const toAbs = queueIndex + toSlot;
  if (fromAbs < 0 || toAbs < 0 || fromAbs >= queue.length || toAbs >= queue.length) return;
  if (fromAbs <= queueIndex || toAbs <= queueIndex) return;

  const [item] = queue.splice(fromAbs, 1);
  queue.splice(toAbs, 0, item);
  prefetched = { id: null, index: -1 };
  await persistSession();
  emit();
}

export async function jumpToQueueIndex(absIndex) {
  if (absIndex < 0 || absIndex >= queue.length) return;
  clearStopFlags();
  ensureQueueLength(absIndex + QUEUE_VISIBLE + 1);
  await playTrackAt(absIndex);
}

export async function playNext(auto = false) {
  if (!queueSource.length) return;
  if (auto && (userStopped || sleepStopped)) return;
  if (!auto) clearStopFlags();
  repeatOnceLeft = false;

  const next = nextQueueIndex();
  if (trySyncAdvance(next)) return;
  await playTrackAt(next);
}

export async function playPrevious() {
  if (!queueSource.length) return;
  clearStopFlags();
  const a = getAudio();
  if (a.currentTime > 3) {
    a.currentTime = 0;
    emit();
    return;
  }
  let prev = queueIndex - 1;
  if (prev < 0) prev = Math.max(0, queue.length - 1);
  await playTrackAt(prev);
}

function assignSrc(playerIndex, blob) {
  const prev = objectUrls[playerIndex];
  const url = URL.createObjectURL(blob);
  objectUrls[playerIndex] = url;
  players[playerIndex].src = url;
  if (prev && prev !== url) {
    setTimeout(() => URL.revokeObjectURL(prev), 2500);
  }
  return url;
}

async function playEl(el) {
  setPlaybackAudioSession();
  try {
    await el.play();
  } catch (err) {
    if (err?.name === 'AbortError' && !el.paused) return;
    await new Promise((r) => setTimeout(r, 50));
    await el.play();
  }
}

function afterTrackStarted(id, label = '') {
  prefetched = { id: null, index: -1 };
  if (label) stateContextLabel = label;
  persistSession().catch(() => {});
  emit();
  prefetchNext();
}

/** play() synchrone sur le lecteur de secours — aucun await avant. */
function trySyncAdvance(index) {
  if (index == null || index < 0) return false;
  ensureQueueLength(index + 1);
  const id = queue[index];
  if (!id || !players[0]) return false;

  const standbyIdx = 1 - activePlayer;
  const standby = players[standbyIdx];
  const loaded = prefetched.id === id && standby?.src;
  if (!loaded) {
    const blob = blobCache.get(id);
    if (!blob) return false;
    assignSrc(standbyIdx, blob);
    prefetched = { id, index };
  }

  lastAdvanceAt = Date.now();
  advancing = true;
  setPlaybackAudioSession();
  const playPromise = standby.play();
  const outgoing = players[activePlayer];
  activePlayer = standbyIdx;
  queueIndex = index;
  currentTrackId = id;
  repeatOnceLeft = false;
  try {
    outgoing.pause();
  } catch {
    /* ignore */
  }

  playPromise
    .then(() => {
      advancing = false;
      afterTrackStarted(id);
    })
    .catch((err) => {
      console.warn('sync advance failed:', err);
      advancing = false;
      playTrackAt(index, '', 0, { allowSync: false }).catch(() => {});
    });
  return true;
}

function prefetchNext() {
  if (prefetchInFlight || userStopped || sleepStopped) return;
  if (!queueSource.length || queueIndex < 0) return;

  const next = queueIndex + 1;
  ensureQueueLength(next + 1);
  const nextId = queue[next];
  if (!nextId) return;
  if (prefetched.id === nextId && prefetched.index === next) return;

  const apply = (blob) => {
    cacheBlob(nextId, blob);
    if (queue[queueIndex + 1] !== nextId) return;
    assignSrc(1 - activePlayer, blob);
    prefetched = { id: nextId, index: next };
  };

  if (blobCache.has(nextId)) {
    apply(blobCache.get(nextId));
    return;
  }

  prefetchInFlight = true;
  getTrack(nextId)
    .then((track) => {
      if (track?.blob) apply(track.blob);
    })
    .catch(() => {})
    .finally(() => {
      prefetchInFlight = false;
    });
}

function maybePrefetch() {
  prefetchNext();
}

async function playTrackAt(index, label = '', skipCount = 0, opts = {}) {
  if (index < 0) return;
  ensureQueueLength(index + QUEUE_VISIBLE + 1);
  if (index >= queue.length) return;
  if (skipCount > 25) {
    emit();
    return;
  }

  if (opts.allowSync !== false && trySyncAdvance(index)) {
    if (label) stateContextLabel = label;
    return;
  }

  lastAdvanceAt = Date.now();
  queueIndex = index;
  const trackId = queue[queueIndex];
  const track = await getTrack(trackId);
  if (!track?.blob) {
    queue.splice(index, 1);
    queueSource = queueSource.filter((id) => id !== trackId);
    if (!queueSource.length) {
      emit();
      return;
    }
    ensureQueueLength(index + QUEUE_VISIBLE + 1);
    await playTrackAt(Math.min(index, queue.length - 1), label, skipCount + 1);
    return;
  }

  cacheBlob(trackId, track.blob);
  const a = getAudio();
  assignSrc(activePlayer, track.blob);
  currentTrackId = trackId;
  repeatOnceLeft = false;
  try {
    await playEl(a);
  } catch (err) {
    console.warn('playTrackAt:', err);
    ensureQueueLength(index + 2);
    await playTrackAt(index + 1, label, skipCount + 1);
    return;
  }

  afterTrackStarted(trackId, label);
}

export async function enrichState(state) {
  if (state.trackId) {
    state.track = await getTrack(state.trackId);
    state.contextLabel = stateContextLabel;
  }
  return state;
}

export function pause() {
  userStopped = true;
  getAudio().pause();
  emit();
}

export function toggle() {
  const a = getAudio();
  if (a.paused) {
    userStopped = false;
    sleepStopped = false;
    if (isNearEnd(a) && queueSource.length) {
      playNext(false).catch(() => {});
      return;
    }
    a.play().catch(() => {});
  } else {
    userStopped = true;
    a.pause();
  }
  emit();
}

export function seek(ratio) {
  const a = getAudio();
  if (!a.duration) return;
  a.currentTime = a.duration * Math.max(0, Math.min(1, ratio));
  emit();
}

export function seekSeconds(sec) {
  const a = getAudio();
  a.currentTime = Math.max(0, Math.min(a.duration || 0, sec));
  emit();
}

export function setSleepTimer(minutes) {
  clearSleepTimer();
  if (!minutes) {
    emit();
    return;
  }
  timerEndAt = Date.now() + minutes * 60 * 1000;
  timerId = setInterval(() => {
    if (Date.now() >= timerEndAt) {
      clearSleepTimer();
      fadeOutAndStop();
    }
    emit();
  }, 1000);
  emit();
}

export function clearSleepTimer() {
  if (timerId) clearInterval(timerId);
  timerId = null;
  timerEndAt = null;
}

async function fadeOutAndStop() {
  sleepStopped = true;
  userStopped = true;
  const a = getAudio();
  const steps = 24;
  const stepMs = 180;
  const startVol = a.volume;
  for (let i = 0; i < steps; i++) {
    if (!sleepStopped) break;
    a.volume = startVol * (1 - (i + 1) / steps);
    await new Promise((r) => setTimeout(r, stepMs));
  }
  a.pause();
  a.volume = startVol;
  emit();
}

export { repeatIconForMode as getRepeatIcon } from './icons.js';
