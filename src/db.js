import { openDB } from 'idb';

const DB_NAME = 'subliminaux';
const DB_VERSION = 1;

let dbPromise;

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

export async function getAllTracks() {
  const db = await getDB();
  const tracks = await db.getAll('tracks');
  return tracks.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getTrack(id) {
  const db = await getDB();
  return db.get('tracks', id);
}

export async function saveTrack(track) {
  const db = await getDB();
  await db.put('tracks', track);
  return track;
}

export async function deleteTrack(id) {
  const db = await getDB();
  await db.delete('tracks', id);
}

export async function getAllPlaylists() {
  const db = await getDB();
  return db.getAll('playlists');
}

export async function savePlaylist(playlist) {
  const db = await getDB();
  await db.put('playlists', playlist);
  return playlist;
}

export async function deletePlaylist(id) {
  const db = await getDB();
  await db.delete('playlists', id);
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
