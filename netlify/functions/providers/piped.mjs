/** Instances Piped — liste live + secours. */
const FALLBACK = ['https://api.piped.private.coffee'];

let cachedInstances = null;

async function loadInstances() {
  if (cachedInstances) return cachedInstances;
  try {
    const res = await fetch('https://piped-instances.kavin.rocks/', {
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) {
      const raw = await res.json();
      const bases = raw
        .map((row) => row.api_url || row.api)
        .filter(Boolean)
        .slice(0, 8);
      if (bases.length) {
        cachedInstances = bases;
        return bases;
      }
    }
  } catch {
    /* liste indisponible */
  }
  cachedInstances = FALLBACK;
  return FALLBACK;
}

/** Bloque LBRY/odycdn (CDN qui refuse les IP cloud Netlify). */
function isUsableUrl(url) {
  if (!url) return false;
  if (/odycdn\.com|player\.odycdn|lbry\.tv|lbrynet/i.test(url)) return false;
  return true;
}

function pickStream(data) {
  const audio =
    data.audioStreams?.find(
      (s) => isUsableUrl(s.url) && s.mimeType?.includes('audio'),
    ) || data.audioStreams?.find((s) => isUsableUrl(s.url));
  if (audio?.url) return audio;

  const muxed =
    data.videoStreams?.find(
      (s) =>
        isUsableUrl(s.url) &&
        !s.videoOnly &&
        !s.quality?.startsWith('LBRY') &&
        s.mimeType?.includes('video'),
    ) ||
    data.videoStreams?.find(
      (s) => isUsableUrl(s.url) && !s.videoOnly && !s.quality?.startsWith('LBRY'),
    );
  if (muxed?.url) return muxed;

  return null;
}

export async function resolveViaPiped(videoId) {
  const bases = await loadInstances();

  for (const base of bases) {
    try {
      const api = base.replace(/\/$/, '');
      const res = await fetch(`${api}/streams/${videoId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Sublimilou/1.0)' },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) continue;

      const raw = await res.text();
      if (!raw.startsWith('{')) continue;

      const data = JSON.parse(raw);
      const stream = pickStream(data);
      if (!stream?.url) {
        console.log('piped: no usable stream from', base);
        continue;
      }

      return {
        videoId,
        title: data.title || 'Sans titre',
        duration: data.duration || 0,
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        mimeType: stream.mimeType || 'audio/mp4',
        streamUrl: stream.url,
        source: 'piped',
      };
    } catch (err) {
      console.error('piped:', base, String(err.message || err).slice(0, 120));
    }
  }
  return null;
}
