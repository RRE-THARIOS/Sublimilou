import { readBody, sendJson } from '../lib/http.mjs';
import {
  canDirectDownload,
  extractVideoId,
  normalizeYoutubeUrl,
  signStream,
} from '../lib/utils.mjs';
import { resolveViaNodeYtdl } from '../providers/node-ytdl.mjs';
import { resolveViaYtdlp } from '../providers/ytdlp.mjs';
import { resolveViaPiped } from '../providers/piped.mjs';
import { resolveViaCobalt } from '../providers/cobalt.mjs';
import { resolveViaInvidious } from '../providers/invidious.mjs';

function isUnavailable(r) {
  return r?.unavailable === true;
}

function isBotBlocked(r) {
  return r?.botBlocked === true;
}

function hasStream(r) {
  return Boolean(r?.streamUrl);
}

async function readYoutubeUrl(req, url) {
  const fromHeader =
    req.headers['x-youtube-url'] || req.headers['x-sublimilou-youtube-url'];
  if (fromHeader?.trim()) return fromHeader.trim();

  const fromQuery = url.searchParams.get('url');
  if (fromQuery?.trim()) return fromQuery.trim();

  if (req.method !== 'POST') return null;

  try {
    const ct = req.headers['content-type'] || '';
    const raw = await readBody(req);
    if (!raw.length) return null;
    const text = raw.toString('utf8');
    if (ct.includes('application/json')) {
      const parsed = JSON.parse(text);
      const u = parsed?.url;
      return typeof u === 'string' ? u.trim() : null;
    }
    if (ct.includes('application/x-www-form-urlencoded')) {
      return new URLSearchParams(text).get('url')?.trim() || null;
    }
    const parsed = JSON.parse(text);
    return typeof parsed?.url === 'string' ? parsed.url.trim() : null;
  } catch {
    return null;
  }
}

export async function handleYoutubeResolve(req, res, url) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return sendJson(res, { error: 'Méthode non autorisée', code: 'METHOD' }, 405);
  }

  try {
    const rawUrl = await readYoutubeUrl(req, url);
    if (!rawUrl) {
      return sendJson(
        res,
        {
          error:
            'Lien YouTube manquant. Colle un lien puis appuie sur « Importer ».',
          code: 'MISSING_URL',
        },
        400,
      );
    }

    const normalized = normalizeYoutubeUrl(rawUrl);
    const videoId = extractVideoId(rawUrl);

    if (!normalized || !videoId) {
      return sendJson(
        res,
        {
          error:
            'Lien invalide. Vérifie qu’il commence par https://www.youtube.com/… ou youtu.be/…',
          code: 'INVALID_URL',
        },
        400,
      );
    }

    const providers = [];
    if (process.env.COBALT_API_KEY || process.env.COBALT_API_URL) {
      providers.push({
        name: 'cobalt',
        run: () => resolveViaCobalt(normalized).then((r) => (r ? { videoId, ...r } : null)),
      });
    }
    providers.push(
      { name: 'ytdlp', run: () => resolveViaYtdlp(normalized, videoId) },
      { name: 'ytdl-core', run: () => resolveViaNodeYtdl(normalized, videoId) },
      { name: 'piped', run: () => resolveViaPiped(videoId) },
      { name: 'invidious', run: () => resolveViaInvidious(videoId) },
    );

    // Lancer tous les providers en parallèle.
    // On retourne dès que le PREMIER valide répond — les lents (yt-dlp ~4s) ne bloquent plus.
    // Les résultats restants sont collectés en arrière-plan pour le log.
    const t0global = Date.now();
    const tried = [];
    let unavailableHits = 0;
    let botBlockedHits = 0;

    const result = await new Promise((resolve) => {
      let pending = providers.length;
      let resolved = false;

      for (const { name, run } of providers) {
        const t0 = Date.now();
        run()
          .then((attempt) => {
            const ms = Date.now() - t0;
            if (isBotBlocked(attempt)) {
              tried.push(`${name}:bot:${ms}ms`);
              botBlockedHits += 1;
            } else if (isUnavailable(attempt)) {
              tried.push(`${name}:unavailable:${ms}ms`);
              unavailableHits += 1;
            } else if (hasStream(attempt)) {
              tried.push(`${name}:OK:${ms}ms`);
              if (!resolved) {
                resolved = true;
                resolve(attempt);
              }
            } else {
              tried.push(`${name}:fail:${ms}ms`);
            }
          })
          .catch(() => tried.push(`${name}:err`))
          .finally(() => {
            pending -= 1;
            if (pending === 0 && !resolved) resolve(null);
          });
      }
    });

    console.log(`youtube-resolve (${Date.now() - t0global}ms):`, tried.join(' | '));

    if (!hasStream(result)) {
      if (unavailableHits >= 2) {
        return sendJson(
          res,
          {
            error:
              'Cette vidéo n’est pas accessible (privée, supprimée ou bloquée). Essaie un autre lien public.',
            code: 'VIDEO_UNAVAILABLE',
          },
          400,
        );
      }
      if (
        botBlockedHits >= 1 &&
        !process.env.COBALT_API_KEY &&
        !process.env.COBALT_API_URL &&
        !process.env.YTDLP_COOKIES_B64 &&
        unavailableHits === 0
      ) {
        return sendJson(
          res,
          {
            error:
              'YouTube bloque l’import depuis notre serveur pour cette vidéo. Réessaie plus tard, teste un autre lien, ou configure une clé API Cobalt sur Fly (voir README).',
            code: 'YOUTUBE_BOT_BLOCK',
          },
          503,
        );
      }
      return sendJson(
        res,
        {
          error:
            'Impossible de récupérer l’audio pour l’instant. Réessaie dans un instant.',
          code: 'NO_STREAM',
          providers: tried,
        },
        502,
      );
    }

    if (!result.thumbnail) {
      result.thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    }

    const direct = result.directOk || canDirectDownload(result.streamUrl);

    // Pour les sources "directOk" (ex: proxy Invidious), on fournit les deux :
    // streamUrl pour un téléchargement direct navigateur rapide,
    // et downloadToken comme fallback si le direct échoue (CORS, redirect vers IP-locked, etc.)
    const token = signStream(result.streamUrl, result.mimeType, {
      videoUrl: normalized,
      source: result.source,
    });

    return sendJson(res, {
      videoId: result.videoId,
      title: result.title,
      duration: result.duration,
      thumbnail: result.thumbnail,
      mimeType: result.mimeType,
      directDownload: direct,
      streamUrl: direct ? result.streamUrl : undefined,
      downloadToken: token,
    });
  } catch (err) {
    console.error('youtube-resolve:', err);
    return sendJson(res, { error: 'Erreur serveur. Réessaie plus tard.' }, 500);
  }
}
