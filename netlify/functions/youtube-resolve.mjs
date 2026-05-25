import {
  corsPreflight,
  extractVideoId,
  jsonResponse,
  normalizeYoutubeUrl,
  signStream,
} from './utils.mjs';
import { resolveViaYtdlp } from './providers/ytdlp.mjs';
import { resolveViaPiped } from './providers/piped.mjs';
import { resolveViaCobalt } from './providers/cobalt.mjs';
import { resolveViaInvidious } from './providers/invidious.mjs';

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

    let result = await resolveViaYtdlp(normalized, videoId);

    if (result?.unavailable) {
      return jsonResponse(
        {
          error:
            'Cette vidéo n’est pas accessible (privée, supprimée ou bloquée). Essaie un autre lien public.',
          code: 'VIDEO_UNAVAILABLE',
        },
        400,
      );
    }
    if (result?.streamUrl) {
      return jsonResponse({
        videoId: result.videoId,
        title: result.title,
        duration: result.duration,
        thumbnail: result.thumbnail,
        mimeType: result.mimeType,
        downloadToken: signStream(result.streamUrl, result.mimeType),
      });
    }

    result = null;
    result = await resolveViaPiped(videoId);
    if (!result) result = await resolveViaInvidious(videoId);

    if (!result) {
      const cobalt = await resolveViaCobalt(normalized);
      if (cobalt) {
        result = { videoId, ...cobalt };
        if (!result.thumbnail) {
          result.thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
        }
      }
    }

    if (!result?.streamUrl) {
      return jsonResponse(
        {
          error:
            'Impossible de récupérer l’audio pour l’instant. Réessaie dans quelques minutes, ou vérifie que la vidéo est bien publique sur YouTube.',
          code: 'NO_STREAM',
        },
        503,
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
