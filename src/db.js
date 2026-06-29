import { openDB } from 'idb';
import { getCloudUser, getSupabase, isCloudEnabled } from './supabase.js';

const DB_NAME = 'subliminaux';
const DB_VERSION = 1;

let dbPromise;

const TRACKS_TABLE = 'tracks';
const PLAYLISTS_TABLE = 'playlists';
const STORAGE_BUCKET = 'audio';

function extensionFromMime(mime = '') {
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('ogg')) return 'ogg';
  return 'm4a';
}

function toCloudTrackMeta(track, userId) {
  return {
    id: track.id,
    user_id: userId,
    title: track.title || 'Sans titre',
    duration: track.duration || 0,
    thumbnail: track.thumbnail || null,
    youtube_url: track.youtubeUrl || null,
    video_id: track.videoId || null,
    tags: track.tags || [],
    affirmations: track.affirmations || [],
    source: track.source || 'import',
    playlist_ids: track.playlistIds || [],
    mime_type: track.mimeType || 'audio/mp4',
    created_at: track.createdAt || Date.now(),
  };
}

function fromCloudTrackMeta(row) {
  return {
    id: row.id,
    title: row.title,
    duration: row.duration,
    thumbnail: row.thumbnail,
    youtubeUrl: row.youtube_url,
    videoId: row.video_id,
    tags: row.tags || [],
    affirmations: row.affirmations || [],
    source: row.source || 'import',
    playlistIds: row.playlist_ids || [],
    mimeType: row.mime_type || 'audio/mp4',
    createdAt: row.created_at || Date.now(),
  };
}

async function uploadTrackToCloud(track) {
  if (!isCloudEnabled()) return;
  const user = await getCloudUser();
  const supabase = getSupabase();
  if (!user || !supabase) return;
  if (!track.blob) return;

  const ext = extensionFromMime(track.mimeType || track.blob.type);
  const path = `${user.id}/${track.id}.${ext}`;
  const blob = track.blob instanceof Blob
    ? track.blob
    : track.audio instanceof ArrayBuffer
      ? new Blob([track.audio], { type: track.mimeType || 'audio/mp4' })
      : null;
  if (!blob) return;

  const upload = await supabase.storage.from(STORAGE_BUCKET).upload(path, blob, {
    upsert: true,
    contentType: track.mimeType || blob.type || 'audio/mp4',
  });
  if (upload.error) {
    console.warn('supabase upload failed:', upload.error.message);
    return;
  }

  const { error } = await supabase
    .from(TRACKS_TABLE)
    .upsert({ ...toCloudTrackMeta(track, user.id), storage_path: path }, { onConflict: 'id' });
  if (error) console.warn('supabase tracks upsert failed:', error.message);
}

async function deleteTrackFromCloud(id) {
  if (!isCloudEnabled()) return;
  const user = await getCloudUser();
  const supabase = getSupabase();
  if (!user || !supabase) return;

  const { data: row } = await supabase
    .from(TRACKS_TABLE)
    .select('storage_path')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();

  await supabase.from(TRACKS_TABLE).delete().eq('id', id).eq('user_id', user.id);
  if (row?.storage_path) await supabase.storage.from(STORAGE_BUCKET).remove([row.storage_path]);
}

async function fetchCloudTracksMeta() {
  if (!isCloudEnabled()) return [];
  const user = await getCloudUser();
  const supabase = getSupabase();
  if (!user || !supabase) return [];

  const { data, error } = await supabase
    .from(TRACKS_TABLE)
    .select(
      'id,title,duration,thumbnail,youtube_url,video_id,tags,affirmations,source,playlist_ids,mime_type,created_at,storage_path',
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('supabase tracks fetch failed:', error.message);
    return [];
  }
  return data || [];
}

async function ensureTrackBlob(trackId) {
  const db = await getDB();
  const local = await db.get('tracks', trackId);
  if (local?.audio instanceof ArrayBuffer || local?.blob instanceof Blob || local?.blob instanceof ArrayBuffer) {
    return hydrateTrack(local);
  }

  if (!isCloudEnabled()) return hydrateTrack(local);
  const user = await getCloudUser();
  const supabase = getSupabase();
  if (!user || !supabase) return hydrateTrack(local);

  const { data: row, error } = await supabase
    .from(TRACKS_TABLE)
    .select('id,mime_type,storage_path')
    .eq('id', trackId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error || !row?.storage_path) return hydrateTrack(local);

  const dl = await supabase.storage.from(STORAGE_BUCKET).download(row.storage_path);
  if (dl.error || !dl.data) return hydrateTrack(local);

  const blob = dl.data;
  const merged = {
    ...(local || { id: trackId, createdAt: Date.now() }),
    mimeType: row.mime_type || local?.mimeType || blob.type || 'audio/mp4',
    audio: await blob.arrayBuffer(),
  };
  await db.put('tracks', merged);
  return hydrateTrack(merged);
}

async function fetchCloudPlaylists() {
  if (!isCloudEnabled()) return [];
  const user = await getCloudUser();
  const supabase = getSupabase();
  if (!user || !supabase) return [];

  const { data, error } = await supabase
    .from(PLAYLISTS_TABLE)
    .select('id,name,track_ids,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('supabase playlists fetch failed:', error.message);
    return [];
  }
  return (data || []).map((row) => ({
    id: row.id,
    name: row.name,
    trackIds: row.track_ids || [],
    createdAt: row.created_at || Date.now(),
  }));
}

async function upsertCloudPlaylist(playlist) {
  if (!isCloudEnabled()) return;
  const user = await getCloudUser();
  const supabase = getSupabase();
  if (!user || !supabase) return;
  const { error } = await supabase.from(PLAYLISTS_TABLE).upsert(
    {
      id: playlist.id,
      user_id: user.id,
      name: playlist.name,
      track_ids: playlist.trackIds || [],
      created_at: playlist.createdAt || Date.now(),
    },
    { onConflict: 'id' },
  );
  if (error) console.warn('supabase playlist upsert failed:', error.message);
}

async function removeCloudPlaylist(id) {
  if (!isCloudEnabled()) return;
  const user = await getCloudUser();
  const supabase = getSupabase();
  if (!user || !supabase) return;
  await supabase.from(PLAYLISTS_TABLE).delete().eq('id', id).eq('user_id', user.id);
}

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const tracks = db.createObjectStore('tracks', { keyPath: 'id' });
        tracks.createIndex('by-created', 'createdAt');
        db.createObjectStore('playlists', { keyPath: 'id' });
        db.createObjectStore('settings', { keyPath: 'key' });
      },
    });
  }
  return dbPromise;
}

/** Safari iOS refuse souvent les Blob dans IndexedDB — on stocke un ArrayBuffer. */
async function serializeTrackForIdb(track) {
  const { blob, mimeType, ...rest } = track;
  if (!blob) return track;

  let audio;
  if (blob instanceof Blob) {
    audio = await blob.arrayBuffer();
  } else if (blob instanceof ArrayBuffer) {
    audio = blob;
  } else {
    return track;
  }

  return { ...rest, audio, mimeType: mimeType || 'audio/mpeg' };
}

/** Reconstruit un Blob pour la lecture (compat anciennes entrées + iOS IndexedDB). */
export function hydrateTrack(stored) {
  if (!stored) return stored;

  const { audio, mimeType, blob, ...rest } = stored;
  const mime = mimeType || 'audio/mpeg';

  // audio field : ArrayBuffer (ou objet désérialisé d'IDB sur iOS dont instanceof échoue)
  if (audio != null) {
    if (blob instanceof Blob) return stored; // déjà hydraté
    try {
      return { ...rest, mimeType: mime, blob: new Blob([audio], { type: mime }) };
    } catch { /* fall through */ }
  }

  if (blob instanceof Blob) return stored;

  // blob stocké en ArrayBuffer ou objet ArrayBuffer-like iOS
  if (blob != null) {
    try {
      return { ...rest, mimeType: mime, blob: new Blob([blob], { type: mime }) };
    } catch { /* fall through */ }
  }

  return stored;
}

export async function getAllTracks() {
  const db = await getDB();
  const local = await db.getAll('tracks');
  const map = new Map(local.map((t) => [t.id, hydrateTrack(t)]));
  const cloud = await fetchCloudTracksMeta();

  for (const row of cloud) {
    const base = fromCloudTrackMeta(row);
    if (!map.has(base.id)) {
      map.set(base.id, {
        ...base,
        cloudStoragePath: row.storage_path || null,
      });
    } else {
      map.set(base.id, {
        ...base,
        ...map.get(base.id),
      });
    }
  }

  return [...map.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export async function getTrack(id) {
  return ensureTrackBlob(id);
}

export async function saveTrack(track) {
  const db = await getDB();
  const stored = await serializeTrackForIdb(track);
  try {
    await db.put('tracks', stored);
  } catch (err) {
    if (err?.name === 'QuotaExceededError') {
      throw new Error('Espace insuffisant sur l’appareil. Supprime des titres ou raccourcis la vidéo YouTube.');
    }
    throw err;
  }
  await uploadTrackToCloud({
    ...track,
    ...stored,
    mimeType: track.mimeType || stored.mimeType || 'audio/mp4',
  });
  return hydrateTrack(stored);
}

export async function deleteTrack(id) {
  const db = await getDB();
  await db.delete('tracks', id);
  await deleteTrackFromCloud(id);
}

export async function getAllPlaylists() {
  const db = await getDB();
  const local = await db.getAll('playlists');
  const map = new Map(local.map((p) => [p.id, p]));
  const cloud = await fetchCloudPlaylists();
  for (const p of cloud) map.set(p.id, p);
  return [...map.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export async function savePlaylist(playlist) {
  const db = await getDB();
  await db.put('playlists', playlist);
  await upsertCloudPlaylist(playlist);
  return playlist;
}

export async function deletePlaylist(id) {
  const db = await getDB();
  await db.delete('playlists', id);
  await removeCloudPlaylist(id);
}

export async function getSetting(key, fallback = null) {
  const db = await getDB();
  const row = await db.get('settings', key);
  return row?.value ?? fallback;
}

export async function setSetting(key, value) {
  const db = await getDB();
  await db.put('settings', { key, value });
}
