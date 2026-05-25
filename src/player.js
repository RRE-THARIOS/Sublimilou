import { getTrack, getSetting, setSetting } from './db.js';

let audio = null;
let timerId = null;
let timerEndAt = null;
let currentTrackId = null;
let loopEnabled = false;
let listeners = new Set();

function getAudio() {
  if (!audio) {
    audio = new Audio();
    audio.preload = 'metadata';

    audio.addEventListener('timeupdate', emit);
    audio.addEventListener('ended', () => {
      if (loopEnabled && currentTrackId) {
        audio.currentTime = 0;
        audio.play();
      } else {
        emit();
      }
    });
    audio.addEventListener('play', emit);
    audio.addEventListener('pause', emit);
  }
  return audio;
}

function emit() {
  const state = getState();
  listeners.forEach((fn) => fn(state));
  updateMediaSession(state);
}

function updateMediaSession(state) {
  if (!('mediaSession' in navigator) || !state.track) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: state.track.title,
    artist: 'Subliminaux',
    artwork: state.track.thumbnail
      ? [{ src: state.track.thumbnail, sizes: '512x512', type: 'image/jpeg' }]
      : [],
  });
  navigator.mediaSession.playbackState = state.playing ? 'playing' : 'paused';
}

export function subscribe(fn) {
  listeners.add(fn);
  enrichState(getState()).then(fn);
  return () => listeners.delete(fn);
}

export function getState() {
  const a = audio;
  return {
    trackId: currentTrackId,
    track: null,
    playing: a ? !a.paused : false,
    currentTime: a?.currentTime ?? 0,
    duration: a?.duration || 0,
    loop: loopEnabled,
    timerRemaining: timerEndAt ? Math.max(0, timerEndAt - Date.now()) : 0,
  };
}

export async function loadSettings() {
  loopEnabled = (await getSetting('loop', 'true')) === 'true';
}

export async function setLoop(enabled) {
  loopEnabled = enabled;
  await setSetting('loop', enabled ? 'true' : 'false');
  emit();
}

export async function playTrack(trackId) {
  const track = await getTrack(trackId);
  if (!track?.blob) return;

  const a = getAudio();
  if (currentTrackId !== trackId) {
    currentTrackId = trackId;
    a.src = URL.createObjectURL(track.blob);
    a.load();
  }
  await a.play();
  emit();
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
  a.currentTime = a.duration * ratio;
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
  const steps = 20;
  const stepMs = 200;
  const startVol = a.volume;
  for (let i = 0; i < steps; i++) {
    a.volume = startVol * (1 - (i + 1) / steps);
    await new Promise((r) => setTimeout(r, stepMs));
  }
  a.pause();
  a.volume = startVol;
  emit();
}

export async function enrichState(state) {
  if (state.trackId) {
    state.track = await getTrack(state.trackId);
  }
  return state;
}
