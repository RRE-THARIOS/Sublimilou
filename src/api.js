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

  const fetchResolve = async (method) => {
    const r = await fetch(endpoint, {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify({ url: trimmed }) : undefined,
      cache: 'no-store',
    });
    const d = await r.json().catch(() => ({}));
    return { r, d };
  };

  let { r: res, d: data } = await fetchResolve('POST');

  if (!res.ok && data.code === 'MISSING_URL') {
    ({ r: res, d: data } = await fetchResolve('GET'));
  }

  // Réseau YouTube instable côté cloud: 2 retries courts pour éviter un faux échec utilisateur.
  if (!res.ok && (data.code === 'NO_STREAM' || data.code === 'YOUTUBE_BOT_BLOCK')) {
    for (let i = 0; i < 2; i += 1) {
      await new Promise((r) => setTimeout(r, 900 * (i + 1)));
      ({ r: res, d: data } = await fetchResolve('GET'));
      if (res.ok) break;
      if (!['NO_STREAM', 'YOUTUBE_BOT_BLOCK'].includes(data.code)) break;
    }
  }

  if (!res.ok) {
    throw new Error(data.error || 'Erreur serveur');
  }
  return data;
}

/** Téléchargement direct (Cobalt) — pas de transit serveur. */
async function downloadDirect(streamUrl, mimeType, { onProgress } = {}) {
  const res = await fetch(streamUrl, { cache: 'no-store' });
  if (!res.ok) throw new Error('Téléchargement impossible');

  const total = Number(res.headers.get('Content-Length')) || 0;
  if (!res.body?.getReader) {
    onProgress?.(1);
    return new Blob([await res.arrayBuffer()], { type: mimeType || res.headers.get('Content-Type') });
  }

  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (total > 0) onProgress?.(Math.min(loaded / total, 1));
  }

  onProgress?.(1);
  return new Blob(chunks, { type: mimeType || res.headers.get('Content-Type') || 'audio/mp4' });
}

/** Téléchargement en un bloc via yt-dlp sur le serveur (googlevideo 403). */
async function downloadViaYtdlpPipe(downloadToken, { onProgress } = {}) {
  const url = `${API_BASE}/youtube-stream?token=${encodeURIComponent(downloadToken)}&pipe=1`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Téléchargement impossible');

  const total = Number(res.headers.get('Content-Length')) || 0;
  if (!res.body?.getReader) {
    onProgress?.(1);
    return new Blob([await res.arrayBuffer()], {
      type: res.headers.get('Content-Type') || 'audio/mp4',
    });
  }

  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (total > 0) onProgress?.(Math.min(loaded / total, 1));
    else onProgress?.(0.5);
  }

  onProgress?.(1);
  return new Blob(chunks, { type: res.headers.get('Content-Type') || 'audio/mp4' });
}

/** Via proxy serveur (googlevideo en morceaux, ou yt-dlp en secours). */
async function downloadProxied(downloadToken, { onProgress } = {}) {
  const CHUNK = 4 * 1024 * 1024;
  const base = `${API_BASE}/youtube-stream?token=${encodeURIComponent(downloadToken)}`;

  const probe = await fetch(base, { headers: { Range: 'bytes=0-0' }, cache: 'no-store' });

  if (!probe.ok || probe.headers.get('X-Sublimilou-Mode') === 'ytdlp-pipe') {
    return downloadViaYtdlpPipe(downloadToken, { onProgress });
  }

  const rangeHeader = probe.headers.get('Content-Range');
  if (!rangeHeader) {
    return downloadViaYtdlpPipe(downloadToken, { onProgress });
  }

  const total = parseInt(rangeHeader.split('/')[1], 10);
  if (!Number.isFinite(total) || total <= 0) {
    return downloadViaYtdlpPipe(downloadToken, { onProgress });
  }

  const chunks = [];
  let offset = 0;

  while (offset < total) {
    const end = Math.min(offset + CHUNK - 1, total - 1);
    const res = await fetch(base, {
      headers: { Range: `bytes=${offset}-${end}` },
      cache: 'no-store',
    });
    if (!res.ok) {
      return downloadViaYtdlpPipe(downloadToken, { onProgress });
    }
    chunks.push(await res.arrayBuffer());
    offset = end + 1;
    onProgress?.(Math.min(offset / total, 1));
  }

  const mime = probe.headers.get('Content-Type') || 'audio/mp4';
  return new Blob(chunks, { type: mime });
}

/**
 * @param {string | { downloadToken?: string, directDownload?: boolean, streamUrl?: string, mimeType?: string }} metaOrToken
 */
export async function downloadAudio(metaOrToken, { onProgress } = {}) {
  const meta =
    typeof metaOrToken === 'string' ? { downloadToken: metaOrToken } : metaOrToken || {};

  if (meta.directDownload && meta.streamUrl) {
    try {
      return await downloadDirect(meta.streamUrl, meta.mimeType, { onProgress });
    } catch {
      // Fallback sur le proxy serveur si le téléchargement direct échoue
      // (CORS bloqué, redirect vers URL IP-locked, timeout réseau, etc.)
      if (!meta.downloadToken) throw new Error('Téléchargement impossible.');
    }
  }

  if (!meta.downloadToken) {
    throw new Error('Téléchargement impossible (token manquant).');
  }

  return downloadProxied(meta.downloadToken, { onProgress });
}

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
