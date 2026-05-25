import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { corsPreflight, jsonResponse } from './utils.mjs';

const VOICE = 'fr-FR-DeniseNeural';
const MAX_PHRASES = 5;
const MAX_PHRASE_LEN = 220;

function streamToBuffer(audioStream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    audioStream.on('data', (chunk) => chunks.push(chunk));
    audioStream.on('close', () => resolve(Buffer.concat(chunks)));
    audioStream.on('error', reject);
  });
}

async function synthesizePhrase(tts, text) {
  const { audioStream } = tts.toStream(text, { rate: 0.92, pitch: '-2Hz', volume: 100 });
  return streamToBuffer(audioStream);
}

export default async (req) => {
  if (req.method === 'OPTIONS') return corsPreflight();
  if (req.method !== 'POST') return jsonResponse({ error: 'Méthode non autorisée' }, 405);

  try {
    const body = await req.json();
    const raw = Array.isArray(body.phrases) ? body.phrases : [];
    const phrases = raw
      .map((p) => String(p || '').trim())
      .filter(Boolean)
      .slice(0, MAX_PHRASES)
      .map((p) => p.slice(0, MAX_PHRASE_LEN));

    if (!phrases.length) {
      return jsonResponse({ error: 'Ajoute au moins une affirmation (une ligne).' }, 400);
    }

    const tts = new MsEdgeTTS();
    await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    const clips = [];
    for (const text of phrases) {
      const buffer = await synthesizePhrase(tts, text);
      clips.push({
        text,
        mimeType: 'audio/mpeg',
        audioBase64: buffer.toString('base64'),
      });
    }

    return jsonResponse({ clips, voice: VOICE });
  } catch (err) {
    console.error('tts-batch', err);
    return jsonResponse(
      { error: err.message || 'Synthèse vocale impossible. Réessaie dans un instant.' },
      500,
    );
  }
};
