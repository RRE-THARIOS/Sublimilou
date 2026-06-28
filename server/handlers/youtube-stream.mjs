import { sendText } from '../lib/http.mjs';
import { verifyToken } from '../lib/utils.mjs';
import { readCookieHeader } from '../lib/ytdlp-cookies.mjs';
import { pipeYtdlpAudio, respondYtdlpRangeProbe } from '../lib/ytdlp-stream.mjs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function extractUrlFromStream(streamUrl) {
  if (!streamUrl) return null;
  try {
    const u = new URL(streamUrl);
    const v = u.searchParams.get('v');
    if (v) return `https://www.youtube.com/watch?v=${v}`;
  } catch {
    /* ignore */
  }
  return null;
}

function upstreamHeaders(range) {
  const headers = {
    'User-Agent': UA,
    Accept: '*/*',
    Referer: 'https://www.youtube.com/',
    Origin: 'https://www.youtube.com',
  };
  const cookie = readCookieHeader();
  if (cookie) headers.Cookie = cookie;
  if (range) headers.Range = range;
  return headers;
}

async function fetchUpstream(streamUrl, range) {
  try {
    // Timeout uniquement sur la connexion initiale + headers (15s).
    // Le body est streamé séparément sans timeout pour éviter de couper
    // un téléchargement en cours sur une connexion lente.
    const controller = new AbortController();
    const connectTimer = setTimeout(() => controller.abort(), 15_000);
    const upstream = await fetch(streamUrl, {
      headers: upstreamHeaders(range),
      signal: controller.signal,
    }).finally(() => clearTimeout(connectTimer));
    if (upstream.ok && upstream.status !== 403) return upstream;
    return null;
  } catch {
    return null;
  }
}

export async function handleYoutubeStream(req, res, url) {
  if (req.method !== 'GET') {
    return sendText(res, 'Méthode non autorisée', 405);
  }

  const token = url.searchParams.get('token');
  const data = verifyToken(token);
  if (!data) {
    return sendText(res, 'Token invalide ou expiré', 403);
  }

  const range = req.headers.range;
  const mimeType = data.mimeType || 'audio/mp4';

  try {
    if (url.searchParams.get('pipe') === '1') {
      // D'abord tenter le flux upstream brut (invidious/piped/cobalt), sans Range.
      if (data.streamUrl) {
        const upstream = await fetchUpstream(data.streamUrl);
        if (upstream) {
          res.writeHead(upstream.status, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers':
              'Content-Length, Content-Range, Accept-Ranges, X-Sublimilou-Mode',
            'X-Sublimilou-Mode': 'upstream-pipe',
            'Content-Type': upstream.headers.get('content-type') || mimeType,
          });
          if (!upstream.body) return res.end();
          const reader = upstream.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
          res.end();
          return;
        }
      }

      const videoUrl = data.videoUrl || extractUrlFromStream(data.streamUrl);
      if (!videoUrl) return sendText(res, 'URL vidéo manquante', 502);
      await pipeYtdlpAudio(res, videoUrl, mimeType);
      return;
    }

    if (data.streamUrl) {
      const upstream = await fetchUpstream(data.streamUrl, range);
      if (upstream) {
        const outHeaders = {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers':
            'Content-Length, Content-Range, Accept-Ranges, X-Sublimilou-Mode',
          'Content-Type': upstream.headers.get('content-type') || mimeType,
        };

        const contentLength = upstream.headers.get('content-length');
        const contentRange = upstream.headers.get('content-range');
        const acceptRanges = upstream.headers.get('accept-ranges');

        if (contentLength) outHeaders['Content-Length'] = contentLength;
        if (contentRange) outHeaders['Content-Range'] = contentRange;
        if (acceptRanges) outHeaders['Accept-Ranges'] = acceptRanges;

        res.writeHead(upstream.status, outHeaders);

        if (!upstream.body) {
          res.end();
          return;
        }

        const reader = upstream.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        res.end();
        return;
      }
    }

    const videoUrl = data.videoUrl || extractUrlFromStream(data.streamUrl);
    if (!videoUrl) {
      return sendText(res, 'Flux indisponible', 502);
    }

    // Pour les sources yt-dlp, on répond immédiatement à la sonde Range
    // avec X-Sublimilou-Mode: ytdlp-pipe pour que le client passe directement
    // en mode pipe — évite un 2ème appel yt-dlp juste pour obtenir la taille.
    if (range === 'bytes=0-0') {
      if (data.source === 'ytdlp') {
        res.writeHead(200, {
          'Content-Type': mimeType,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers':
            'Content-Length, Content-Range, Accept-Ranges, X-Sublimilou-Mode',
          'X-Sublimilou-Mode': 'ytdlp-pipe',
        });
        res.end();
        return;
      }
      await respondYtdlpRangeProbe(res, videoUrl, mimeType);
      return;
    }

    if (range && range !== 'bytes=0-0') {
      return sendText(res, 'Utilisez pipe=1 pour ce flux', 400);
    }

    await pipeYtdlpAudio(res, videoUrl, mimeType);
  } catch (err) {
    console.error('youtube-stream:', err);
    if (!res.headersSent) sendText(res, 'Erreur de téléchargement', 502);
    else res.end();
  }
}
