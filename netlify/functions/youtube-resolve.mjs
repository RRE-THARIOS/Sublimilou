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
  if (req.method === 'POST') {
    const body = await req.json();
    return body?.url;
  }
  if (req.method === 'GET') {
    return new URL(req.url).searchParams.get('url');
  }
  return null;
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
            req.method === 'GET'
              ? 'Ajoute ?url=https://www.youtube.com/watch?v=… ou utilise le bouton « Importer » dans l’app.'
              : 'Corps JSON manquant : { "url": "https://www.youtube.com/…" }',
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
      () => resolveViaNodeYtdl(normalized, videoId),
      () => resolveViaYtdlp(normalized, videoId),
      () => resolveViaInvidious(videoId),
      () => resolveViaPiped(videoId),
    ];

    const deadline = Date.now() + 24_000;
    let result = null;
    for (const run of providers) {
      if (Date.now() > deadline) break;
      result = await run();
      if (isUnavailable(result)) {
        return jsonResponse(
          {
            error:
              'Cette vidéo n’est pas accessible (privée, supprimée ou bloquée). Essaie un autre lien public.',
            code: 'VIDEO_UNAVAILABLE',
          },
          400,
        );
      }
      if (hasStream(result)) break;
      result = null;
    }

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
      return jsonResponse(
        {
          error:
            'Impossible de récupérer l’audio pour l’instant. Réessaie dans 1–2 minutes avec une vidéo publique, ou contacte le support si ça persiste.',
          code: 'NO_STREAM',
          hint: 'Les services YouTube tiers sont instables ; un second essai suffit souvent.',
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
