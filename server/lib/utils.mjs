import crypto from 'crypto';

export function getSecret() {
  return process.env.YOUTUBE_PROXY_SECRET || 'change-me-in-production';
}

export function normalizeYoutubeUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;

  s = s.replace(/^ww\./i, 'www.');
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;

  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\./, '');
    if (!['youtube.com', 'youtu.be', 'm.youtube.com', 'music.youtube.com'].includes(host)) {
      return null;
    }
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0]?.slice(0, 11);
      if (!id) return null;
      return `https://www.youtube.com/watch?v=${id}`;
    }
    if (u.pathname.startsWith('/shorts/')) {
      const id = u.pathname.split('/')[2]?.slice(0, 11);
      if (!id) return null;
      return `https://www.youtube.com/watch?v=${id}`;
    }
    if (u.pathname.startsWith('/live/')) {
      const id = u.pathname.split('/')[2]?.slice(0, 11);
      if (!id) return null;
      return `https://www.youtube.com/watch?v=${id}`;
    }
    const id = u.searchParams.get('v')?.slice(0, 11);
    if (!id) return null;
    return `https://www.youtube.com/watch?v=${id}`;
  } catch {
    return null;
  }
}

export function extractVideoId(url) {
  const normalized = normalizeYoutubeUrl(url);
  if (!normalized) return null;

  try {
    const u = new URL(normalized);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0]?.slice(0, 11);
    if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2]?.slice(0, 11);
    if (u.pathname.startsWith('/live/')) return u.pathname.split('/')[2]?.slice(0, 11);
    const v = u.searchParams.get('v');
    return v?.slice(0, 11) || null;
  } catch {
    return null;
  }
}

export function signStream(streamUrl, mimeType, extra = {}) {
  const exp = Date.now() + 60 * 60 * 1000;
  const payload = JSON.stringify({
    streamUrl,
    mimeType,
    exp,
    videoUrl: extra.videoUrl || null,
    source: extra.source || null,
  });
  const sig = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
  return Buffer.from(JSON.stringify({ payload, sig })).toString('base64url');
}

export function verifyToken(token) {
  try {
    const { payload, sig } = JSON.parse(Buffer.from(token, 'base64url').toString());
    const expected = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
    if (sig !== expected) return null;
    const data = JSON.parse(payload);
    if (data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

/** Téléchargement direct navigateur possible (évite le double transit serveur). */
export function canDirectDownload(streamUrl) {
  try {
    const host = new URL(streamUrl).hostname;
    // Cobalt (lien direct), googlevideo (invidious/ytdlp), ou CDN piped direct
    return /cobalt\.tools|co\.wtf|googlevideo\.com|\.googlevideo\.com$/i.test(host);
  } catch {
    return false;
  }
}
