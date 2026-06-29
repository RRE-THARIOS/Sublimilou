import { getTrack, getSetting, setSetting } from './db.js';
import { buildQueueFromSource, QUEUE_VISIBLE } from './queue.js';
import { shuffleArray } from './utils.js';

let audio = null;
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
let objectUrl = null;
let stateContextLabel = '';
let mediaSessionReady = false;
let lastPositionUpdate = 0;
let wasPlayingOnHide = false;
let endedInProgress = false; // garde-fou double-ended iOS
let endedFallbackScheduled = false; // fallback iOS timeupdate → ended

function setPlaybackAudioSession() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
  } catch {
    /* Safari */
  }
}

function getAudio() {
  if (!audio) {
    audio = new Audio();
    audio.preload = 'auto';
    audio.setAttribute('playsinline', '');
    audio.setAttribute('webkit-playsinline', 'true');
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onAudioPlay);
    audio.addEventListener('pause', emit);
    audio.addEventListener('loadedmetadata', emit);
    initMediaSessionHandlers();
    bindBackgroundPlaybackGuards();
  }
  return audio;
}

function onTimeUpdate() {
  emit();
  updatePositionStateThrottled();
  // Fallback iOS : 'ended' ne se déclenche pas toujours (verrouillage, arrière-plan…)
  const a = audio;
  if (a && !a.paused && a.duration > 0 && !endedFallbackScheduled && !endedInProgress) {
    if (a.currentTime >= a.duration - 0.35) {
      endedFallbackScheduled = true;
      setTimeout(() => { onEnded().catch(() => {}); }, 0);
    }
  }
}

function onAudioPlay() {
  endedFallbackScheduled = false;
  endedInProgress = false;
  setPlaybackAudioSession();
  emit();
}

function bindBackgroundPlaybackGuards() {
  document.addEventListener('visibilitychange', () => {
    const a = audio;
    if (!a) return;
    if (document.visibilityState === 'hidden') {
      wasPlayingOnHide = !a.paused;
      return;
    }
    if (wasPlayingOnHide && a.paused && currentTrackId) {
      a.play().catch(() => {});
    }
    wasPlayingOnHide = false;
  });

  window.addEventListener('pagehide', () => {
    if (audio && !audio.paused) wasPlayingOnHide = true;
  });

  window.addEventListener('pageshow', () => {
    const a = audio;
    if (wasPlayingOnHide && a?.paused && currentTrackId) {
      a.play().catch(() => {});
    }
    wasPlayingOnHide = false;
  });
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
  const a = audio;
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

async function onEnded() {
  if (endedInProgress) return;
  endedInProgress = true;
  endedFallbackScheduled = false;
  try {
    const a = getAudio();
    if (repeatMode === 'loop' && currentTrackId) {
      a.currentTime = 0;
      await a.play();
      return;
    }
    if (repeatMode === 'once' && currentTrackId) {
      if (!repeatOnceLeft) {
        repeatOnceLeft = true;
        a.currentTime = 0;
        await a.play();
        return;
      }
      repeatMode = 'off';
      repeatOnceLeft = false;
      loopEnabled = false;
      await persistSession();
      emit();
    }
    await playNext(true);
  } finally {
    endedInProgress = false;
  }
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
  const a = audio;
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
  getAudio();
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

  const a = getAudio();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(track.blob);
  currentTrackId = lastId;
  a.src = objectUrl;
  a.load();

  stateContextLabel = 'Reprendre';
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

export async function playQueue(trackIds, { shuffle = false, startIndex = 0, label = '' } = {}) {
  if (!trackIds.length) return;
  queueSource = shuffle ? shuffleArray(trackIds) : [...trackIds];
  shuffleOn = shuffle;
  initQueue(startIndex);
  await persistSession();
  await playTrackAt(queueIndex, label);
}

export async function playTrack(trackId, label = '', { sourceIds = null } = {}) {
  if (sourceIds?.length) {
    queueSource = [...sourceIds];
    const idx = queueSource.indexOf(trackId);
    initQueue(idx >= 0 ? idx : 0);
  } else {
    queueSource = [trackId];
    initQueue(0);
  }
  await persistSession();
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
  await persistSession();
  emit();
}

export async function jumpToQueueIndex(absIndex) {
  if (absIndex < 0 || absIndex >= queue.length) return;
  ensureQueueLength(absIndex + QUEUE_VISIBLE + 1);
  await playTrackAt(absIndex);
}

export async function playNext(auto = false) {
  if (!queueSource.length) return;
  repeatOnceLeft = false;

  const next = queueIndex + 1;
  ensureQueueLength(next + QUEUE_VISIBLE + 1);
  await playTrackAt(next);
}

export async function playPrevious() {
  if (!queueSource.length) return;
  const a = getAudio();
  if (a.currentTime > 3) {
    a.currentTime = 0;
    emit();
    return;
  }
  let prev = queueIndex - 1;
  if (prev < 0) prev = queue.length - 1;
  await playTrackAt(prev);
}

async function playTrackAt(index, label = '') {
  if (index < 0 || index >= queue.length) return;
  queueIndex = index;
  const trackId = queue[queueIndex];
  const track = await getTrack(trackId);
  if (!track?.blob) {
    // Track sans audio : on l'éjecte et on essaie le suivant
    queue.splice(index, 1);
    queueSource = queueSource.filter((id) => id !== trackId);
    if (!queueSource.length) { emit(); return; }
    initQueue(Math.min(queueIndex, queueSource.length - 1));
    await playTrackAt(queueIndex, label);
    return;
  }

  ensureQueueLength(queueIndex + QUEUE_VISIBLE + 1);

  const a = getAudio();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(track.blob);
  currentTrackId = trackId;
  repeatOnceLeft = false;
  a.src = objectUrl;
  a.load();
  setPlaybackAudioSession();
  await a.play();
  await setSetting('lastTrackId', trackId);
  if (label) stateContextLabel = label;
  await persistSession();
  emit();
}

export async function enrichState(state) {
  if (state.trackId) {
    state.track = await getTrack(state.trackId);
    state.contextLabel = stateContextLabel;
  }
  return state;
}

export function pause() {
  getAudio().pause();
  emit();
}

export function toggle() {
  const a = getAudio();
  if (a.paused) a.play();
  else a.pause();
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
  const a = getAudio();
  const steps = 24;
  const stepMs = 180;
  const startVol = a.volume;
  for (let i = 0; i < steps; i++) {
    a.volume = startVol * (1 - (i + 1) / steps);
    await new Promise((r) => setTimeout(r, stepMs));
  }
  a.pause();
  a.volume = startVol;
  emit();
}

export { repeatIconForMode as getRepeatIcon } from './icons.js';
