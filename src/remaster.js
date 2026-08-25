import { synthesizeAffirmations } from './api.js';
import { BUNDLED_AUDIOS } from './bundled-audios.js';
import { saveTrack } from './db.js';
import {
  DEFAULT_MUSIC_GAIN,
  DEFAULT_VOICE_GAIN,
  MIX_VERSION,
  mixSubliminal,
} from './mix-subliminal.js';

export { MIX_VERSION };

export function resolveBaseAudio(track) {
  if (track?.baseAudioId) {
    const found = BUNDLED_AUDIOS.find((a) => a.id === track.baseAudioId);
    if (found) return found;
  }
  return BUNDLED_AUDIOS[0] || null;
}

export function trackNeedsRemaster(track) {
  const phrases = Array.isArray(track?.affirmations)
    ? track.affirmations.map((p) => String(p).trim()).filter(Boolean)
    : [];
  if (!phrases.length) return false;
  if (track.source && track.source !== 'create') return false;
  return (Number(track.mixVersion) || 0) < MIX_VERSION;
}

export function tracksNeedingRemaster(list) {
  return (list || []).filter(trackNeedsRemaster);
}

/**
 * Musique + TTS + mix, même pipeline que la création.
 * @param {string[]} phrases
 * @param {typeof BUNDLED_AUDIOS[0]} audioMeta
 * @param {(pct: number, msg: string) => void} [onProgress]
 */
export async function buildSubliminalMix(phrases, audioMeta, onProgress) {
  onProgress?.(5, 'Chargement de la musique…');
  const res = await fetch(audioMeta.file);
  if (!res.ok) throw new Error('Impossible de charger la musique.');
  const musicBlob = new Blob([await res.arrayBuffer()], { type: audioMeta.mimeType });

  onProgress?.(22, 'Synthèse des voix…');
  const { clips } = await synthesizeAffirmations(phrases);

  onProgress?.(52, 'Mixage (musique + affirmations)…');
  const result = await mixSubliminal(musicBlob, clips, {
    voiceGain: DEFAULT_VOICE_GAIN,
    musicGain: DEFAULT_MUSIC_GAIN,
    onProgress: (p) => onProgress?.(52 + Math.round(p * 44), `Mixage… ${Math.round(p * 100)}%`),
  });
  onProgress?.(98, 'Enregistrement…');
  return result;
}

/**
 * Remixe les subliminaux déjà créés qui n’ont pas encore le mix actuel.
 * @param {object[]} tracks
 * @param {{ onProgress?: (info: { index: number, total: number, title?: string }) => void }} [opts]
 */
export async function remasterOutdatedTracks(tracks, opts = {}) {
  const due = tracksNeedingRemaster(tracks);
  if (!due.length) return { updated: 0, failed: 0, total: 0 };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { updated: 0, failed: 0, total: due.length, offline: true };
  }

  let updated = 0;
  let failed = 0;

  for (let i = 0; i < due.length; i++) {
    const track = due[i];
    const audioMeta = resolveBaseAudio(track);
    const phrases = (track.affirmations || []).map((p) => String(p).trim()).filter(Boolean);
    opts.onProgress?.({ index: i + 1, total: due.length, title: track.title });

    if (!audioMeta || !phrases.length) {
      failed += 1;
      continue;
    }

    try {
      const { blob, duration } = await buildSubliminalMix(phrases, audioMeta);
      const { blob: _oldBlob, audio: _audio, cloudStoragePath: _cloud, ...meta } = track;
      await saveTrack({
        ...meta,
        blob,
        duration: Math.round(duration || audioMeta.duration || track.duration || 0),
        mimeType: blob.type || 'audio/wav',
        mixVersion: MIX_VERSION,
        baseAudioId: audioMeta.id,
        source: track.source || 'create',
        affirmations: phrases,
      });
      updated += 1;
    } catch (err) {
      console.warn('remaster failed:', track.id, err);
      failed += 1;
    }
  }

  return { updated, failed, total: due.length };
}
