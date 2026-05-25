import {
  corsPreflight,
  extractVideoId,
  jsonResponse,
  normalizeYoutubeUrl,
  signStream,
} from './utils.mjs';
import { resolveViaNodeYtdl } from './providers/node-ytdl.mjs';
import { resolveViaYtdlp } from './providers/ytdlp.mjs';
import { resolveViaPiped } from './providers/piped.mjs';
import { resolveViaCobalt } from './providers/cobalt.mjs';
import { resolveViaInvidious } from './providers/invidious.mjs';

function isUnavailable(r) {
  return r?.unavailable === true;
}

function hasStream(r) {
  return Boolean(r?.streamUrl);
}

async function readYoutubeUrl(req) {
  const fromHeader = req.headers.get('x-youtube-url') || req.headers.get('x-sublimilou-youtube-url');
  if (fromHeader?.trim()) return fromHeader.trim();

  const fromQuery = new URL(req.url).searchParams.get('url');
  if (fromQuery?.trim()) return fromQuery.trim();

  if (req.method !== 'POST') return null;

  try {
    const ct = req.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const body = await req.json();
      const u = body?.url;
      return typeof u === 'string' ? u.trim() : null;
    }
    const text = await req.text();
    if (!text) return null;
    if (ct.includes('application/x-www-form-urlencoded')) {
      return new URLSearchParams(text).get('url')?.trim() || null;
    }
    try {
      const parsed = JSON.parse(text);
      return typeof parsed?.url === 'string' ? parsed.url.trim() : null;
    } catch {
      return null;
    }
  } catch (err) {
    console.error('readYoutubeUrl:', err.message);
    return null;
  }
}

export default async (req) => {
  if (req.method === 'OPTIONS') return corsPreflight();

  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResponse({ error: 'Méthode non autorisée', code: 'METHOD' }, 405);
  }

  try {
    const url = await readYoutubeUrl(req);

    if (!url) {
      return jsonResponse(
        {
          error:
            'Lien YouTube manquant côté serveur. Ferme l’app, rouvre-la depuis l’icône, puis réessaie « Importer ».',
          code: 'MISSING_URL',
        },
        400,
      );
    }

    const normalized = normalizeYoutubeUrl(url);
    const videoId = extractVideoId(url);

    if (!normalized || !videoId) {
      return jsonResponse(
        {
          error:
            'Lien invalide. Vérifie qu’il commence par https://www.youtube.com/… ou youtu.be/…',
          code: 'INVALID_URL',
        },
        400,
      );
    }

    const providers = [
      { name: 'ytdlp', run: () => resolveViaYtdlp(normalized, videoId) },
      { name: 'ytdl-core', run: () => resolveViaNodeYtdl(normalized, videoId) },
      { name: 'piped', run: () => resolveViaPiped(videoId) },
      { name: 'invidious', run: () => resolveViaInvidious(videoId) },
    ];

    const deadline = Date.now() + 24_000;
    let result = null;
    let unavailableHits = 0;
    const tried = [];

    for (const { name, run } of providers) {
      if (Date.now() > deadline) break;
      const t0 = Date.now();
      const attempt = await run();
      const ms = Date.now() - t0;
      if (isUnavailable(attempt)) {
        tried.push(`${name}:unavailable:${ms}ms`);
        unavailableHits += 1;
        continue;
      }
      if (hasStream(attempt)) {
        tried.push(`${name}:OK:${ms}ms`);
        result = attempt;
        break;
      }
      tried.push(`${name}:fail:${ms}ms`);
    }
    console.log('youtube-resolve providers:', tried.join(' | '));

    if (!result) {
      const cobalt = await resolveViaCobalt(normalized);
      if (cobalt) {
        result = { videoId, ...cobalt };
        if (!result.thumbnail) {
          result.thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
        }
      }
    }

    if (!hasStream(result)) {
      if (unavailableHits >= 2) {
        return jsonResponse(
          {
            error:
              'Cette vidéo n’est pas accessible (privée, supprimée ou bloquée). Essaie un autre lien public.',
            code: 'VIDEO_UNAVAILABLE',
          },
          400,
        );
      }
      return jsonResponse(
        {
          error:
            'Impossible de récupérer l’audio pour l’instant. Réessaie dans 1–2 minutes avec une vidéo publique, ou contacte le support si ça persiste.',
          code: 'NO_STREAM',
          providers: tried,
        },
        502,
      );
    }

    return jsonResponse({
      videoId: result.videoId,
      title: result.title,
      duration: result.duration,
      thumbnail: result.thumbnail,
      mimeType: result.mimeType,
      downloadToken: signStream(result.streamUrl, result.mimeType),
    });
  } catch (err) {
    console.error('youtube-resolve:', err);
    return jsonResponse(
      { error: 'Erreur serveur. Réessaie plus tard.' },
      500,
    );
  }
};
