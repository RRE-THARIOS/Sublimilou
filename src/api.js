const API_BASE = '/api';

export async function resolveYoutube(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) throw new Error('Colle un lien YouTube avant d’importer.');

  const q = `url=${encodeURIComponent(trimmed)}`;
  const endpoint = `${API_BASE}/youtube-resolve?${q}`;

  const headers = {
    'Content-Type': 'application/json',
    'X-Youtube-Url': trimmed,
  };

  let res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ url: trimmed }),
    cache: 'no-store',
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (data.code === 'MISSING_URL') {
      res = await fetch(endpoint, { method: 'GET', headers, cache: 'no-store' });
    }
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Erreur serveur');
  }
  return data;
}

export async function downloadAudio(downloadToken, { onProgress } = {}) {
  const CHUNK = 2 * 1024 * 1024;
  const base = `${API_BASE}/youtube-stream?token=${encodeURIComponent(downloadToken)}`;

  const probe = await fetch(base, { headers: { Range: 'bytes=0-0' } });
  if (!probe.ok) throw new Error('Téléchargement impossible');

  const rangeHeader = probe.headers.get('Content-Range');
  if (!rangeHeader) throw new Error('Taille du fichier inconnue');

  const total = parseInt(rangeHeader.split('/')[1], 10);
  const chunks = [];
  let offset = 0;

  while (offset < total) {
    const end = Math.min(offset + CHUNK - 1, total - 1);
    const res = await fetch(base, {
      headers: { Range: `bytes=${offset}-${end}` },
    });
    if (!res.ok) throw new Error(`Erreur au téléchargement (${res.status})`);
    chunks.push(await res.arrayBuffer());
    offset = end + 1;
    onProgress?.(Math.min(offset / total, 1));
  }

  const mime = probe.headers.get('Content-Type') || 'audio/mp4';
  return new Blob(chunks, { type: mime });
}

/** Synthèse vocale des affirmations (Netlify + edge TTS gratuit). */
export async function synthesizeAffirmations(phrases) {
  const res = await fetch(`${API_BASE}/tts-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phrases }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Synthèse vocale impossible');
  return data;
}
