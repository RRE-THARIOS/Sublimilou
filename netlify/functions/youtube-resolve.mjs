import {
  corsPreflight,
  extractVideoId,
  jsonResponse,
  signStream,
} from './utils.mjs';
import { resolveViaPiped } from './providers/piped.mjs';
import { resolveViaCobalt } from './providers/cobalt.mjs';

export default async (req) => {
  if (req.method === 'OPTIONS') return corsPreflight();
  if (req.method !== 'POST') return jsonResponse({ error: 'Méthode non autorisée' }, 405);

  try {
    const { url } = await req.json();
    const videoId = extractVideoId(url);
    if (!videoId) return jsonResponse({ error: 'Lien YouTube invalide' }, 400);

    let result = await resolveViaPiped(videoId);

    if (!result) {
      const cobalt = await resolveViaCobalt(url);
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
            'Impossible de récupérer l’audio pour l’instant. Réessaie dans quelques minutes, ou ajoute une clé Cobalt (voir README).',
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
