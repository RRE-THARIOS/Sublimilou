import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { readJson, sendJson } from '../lib/http.mjs';

const VOICE = 'fr-FR-DeniseNeural';
const MAX_PHRASE_LEN = 220;
const PHRASE_TIMEOUT_MS = 15_000;
const PARALLEL_LIMIT = 4;

function streamToBuffer(audioStream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    audioStream.on('data', (chunk) => chunks.push(chunk));
    audioStream.on('end', () => resolve(Buffer.concat(chunks)));
    audioStream.on('error', reject);
  });
}

async function synthesizePhraseWithTimeout(text) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout TTS pour : ${text.slice(0, 40)}`)), PHRASE_TIMEOUT_MS),
  );

  const { audioStream } = tts.toStream(text, { rate: 0.92, pitch: '-2Hz', volume: 100 });
  const buffer = await Promise.race([streamToBuffer(audioStream), timeout]);
  return buffer;
}

async function synthesizeInParallel(phrases) {
  const results = new Array(phrases.length);
  let i = 0;

  async function worker() {
    while (i < phrases.length) {
      const idx = i++;
      results[idx] = await synthesizePhraseWithTimeout(phrases[idx]);
    }
  }

  const workers = Array.from({ length: Math.min(PARALLEL_LIMIT, phrases.length) }, worker);
  await Promise.all(workers);
  return results;
}

export async function handleTtsBatch(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, { error: 'Méthode non autorisée' }, 405);
  }

  try {
    const body = await readJson(req);
    const raw = Array.isArray(body?.phrases) ? body.phrases : [];
    const phrases = raw
      .map((p) => String(p || '').trim())
      .filter(Boolean)
      .map((p) => p.slice(0, MAX_PHRASE_LEN));

    if (!phrases.length) {
      return sendJson(res, { error: 'Ajoute au moins une affirmation (une ligne).' }, 400);
    }

    const buffers = await synthesizeInParallel(phrases);

    const clips = phrases.map((text, i) => ({
      text,
      mimeType: 'audio/mpeg',
      audioBase64: buffers[i].toString('base64'),
    }));

    return sendJson(res, { clips, voice: VOICE });
  } catch (err) {
    console.error('tts-batch', err);
    return sendJson(
      res,
      { error: err.message || 'Synthèse vocale impossible. Réessaie dans un instant.' },
      500,
    );
  }
}
