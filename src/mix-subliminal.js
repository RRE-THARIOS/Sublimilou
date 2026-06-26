/** Durée max du morceau de base (secondes) */
export const MAX_BASE_DURATION_SEC = 8 * 60;

/** Volume des affirmations (0–1, très bas par défaut) */
export const DEFAULT_VOICE_GAIN = 0.038;

/** Pause entre deux phrases (secondes) */
export const PHRASE_GAP_SEC = 0.75;

/** Délai avant la première voix (laisse la musique se lancer) */
export const VOICE_START_DELAY_SEC = 4;

/**
 * Décode un Blob audio en AudioBuffer.
 * @param {Blob} blob
 * @param {AudioContext} ctx
 */
export async function decodeBlob(blob, ctx) {
  const ab = await blob.arrayBuffer();
  return ctx.decodeAudioData(ab.slice(0));
}

/**
 * Mixe la musique de base avec des clips voix en boucle jusqu'à la fin.
 * @param {Blob} baseBlob
 * @param {{ audioBase64: string, mimeType?: string }[]} clips
 * @param {{ voiceGain?: number, onProgress?: (n: number) => void }} opts
 * @returns {Promise<{ blob: Blob, duration: number, sampleRate: number }>}
 */
export async function mixSubliminal(baseBlob, clips, opts = {}) {
  const voiceGain = opts.voiceGain ?? DEFAULT_VOICE_GAIN;
  const gap = PHRASE_GAP_SEC;

  const ctx = new AudioContext();
  let base;
  const phraseBuffers = [];

  try {
    opts.onProgress?.(0.05);
    base = await decodeBlob(baseBlob, ctx);
    opts.onProgress?.(0.2);

    if (base.duration > MAX_BASE_DURATION_SEC) {
      throw new Error(
        `Piste trop longue (${Math.ceil(base.duration / 60)} min). Maximum ${MAX_BASE_DURATION_SEC / 60} minutes.`,
      );
    }

    for (let i = 0; i < clips.length; i++) {
      const b64 = clips[i].audioBase64;
      const binary = atob(b64);
      const raw = new Uint8Array(binary.length);
      for (let j = 0; j < binary.length; j++) raw[j] = binary.charCodeAt(j);
      const buf = await ctx.decodeAudioData(raw.buffer);
      phraseBuffers.push(buf);
      opts.onProgress?.(0.2 + (0.25 * (i + 1)) / clips.length);
    }
  } finally {
    await ctx.close().catch(() => {});
  }

  try {
    const channels = base.numberOfChannels;
    const sampleRate = base.sampleRate;
    const length = base.length;

    const offline = new OfflineAudioContext(channels, length, sampleRate);
    const master = offline.createGain();
    master.gain.value = 1;
    master.connect(offline.destination);

    const baseSrc = offline.createBufferSource();
    baseSrc.buffer = base;
    baseSrc.connect(master);
    baseSrc.start(0);

    const voiceBus = offline.createGain();
    voiceBus.gain.value = voiceGain;
    voiceBus.connect(master);

    let time = VOICE_START_DELAY_SEC;
    let idx = 0;
    let safety = 0;
    const maxIterations = 5000;

    while (time < base.duration && safety < maxIterations) {
      const phrase = phraseBuffers[idx % phraseBuffers.length];
      if (!phrase) break;
      if (time + 0.05 >= base.duration) break;

      const src = offline.createBufferSource();
      src.buffer = phrase;
      src.playbackRate.value = 2;
      src.connect(voiceBus);
      src.start(time);

      time += phrase.duration / 2 + gap;
      idx += 1;
      safety += 1;
    }

    opts.onProgress?.(0.55);
    const rendered = await offline.startRendering();
    opts.onProgress?.(0.85);

    const wavBlob = audioBufferToWavBlob(rendered);
    opts.onProgress?.(1);

    return {
      blob: wavBlob,
      duration: rendered.duration,
      sampleRate: rendered.sampleRate,
    };
  }
}

/** Export WAV mono 16-bit (compatible lecture partout). */
function audioBufferToWavBlob(buffer) {
  const numCh = 1;
  const sampleRate = buffer.sampleRate;
  const samples = interleaveDownmix(buffer);
  const bytesPerSample = 2;
  const blockAlign = numCh * bytesPerSample;
  const dataSize = samples.length * bytesPerSample;
  const bufferLength = 44 + dataSize;
  const array = new ArrayBuffer(bufferLength);
  const view = new DataView(array);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([array], { type: 'audio/wav' });
}

function interleaveDownmix(buffer) {
  const ch = buffer.numberOfChannels;
  const len = buffer.length;
  const out = new Float32Array(len);
  for (let c = 0; c < ch; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) out[i] += data[i] / ch;
  }
  return out;
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}
