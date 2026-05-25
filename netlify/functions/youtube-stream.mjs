import { corsPreflight, verifyToken } from './utils.mjs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export default async (req) => {
  if (req.method === 'OPTIONS') return corsPreflight();
  if (req.method !== 'GET') {
    return new Response('Méthode non autorisée', { status: 405 });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  const data = verifyToken(token);

  if (!data) {
    return new Response('Token invalide ou expiré', { status: 403 });
  }

  const range = req.headers.get('range');
  const headers = {
    'User-Agent': UA,
    Accept: '*/*',
  };
  if (range) headers.Range = range;

  try {
    const upstream = await fetch(data.streamUrl, { headers });
    const outHeaders = new Headers({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
      'Content-Type': upstream.headers.get('content-type') || data.mimeType || 'audio/mp4',
    });

    const contentLength = upstream.headers.get('content-length');
    const contentRange = upstream.headers.get('content-range');
    const acceptRanges = upstream.headers.get('accept-ranges');

    if (contentLength) outHeaders.set('Content-Length', contentLength);
    if (contentRange) outHeaders.set('Content-Range', contentRange);
    if (acceptRanges) outHeaders.set('Accept-Ranges', acceptRanges);

    return new Response(upstream.body, {
      status: upstream.status,
      headers: outHeaders,
    });
  } catch (err) {
    console.error('youtube-stream:', err);
    return new Response('Erreur de téléchargement', { status: 502 });
  }
};
