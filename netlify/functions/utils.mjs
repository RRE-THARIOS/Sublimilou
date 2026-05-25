import crypto from 'crypto';

const DEFAULT_SECRET = 'change-me-in-netlify-env';

export function getSecret() {
  return process.env.YOUTUBE_PROXY_SECRET || DEFAULT_SECRET;
}

/** Corrige les liens mal saisis (ww.youtube, sans https, etc.) */
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
    return u.toString();
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

export function signStream(streamUrl, mimeType) {
  const exp = Date.now() + 60 * 60 * 1000;
  const payload = JSON.stringify({ streamUrl, mimeType, exp });
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

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export function corsPreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type, Range, X-Youtube-Url, X-Sublimilou-Youtube-Url',
    },
  });
}
