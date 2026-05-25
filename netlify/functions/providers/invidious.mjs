const FALLBACK = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://yt.chocolatemoo53.com',
  'https://invidious.f5.si',
  'https://yewtu.be',
  'https://invidious.fdn.fr',
];

let cachedBases = null;

async function loadInstances() {
  if (cachedBases) return cachedBases;
  try {
    const res = await fetch(
      'https://api.invidious.io/instances.json?sort_by=api',
      { signal: AbortSignal.timeout(8_000) },
    );
    if (res.ok) {
      const raw = await res.json();
      const bases = raw
        .filter((row) => Array.isArray(row) && row[0])
        .map((row) => `https://${row[0]}`)
        .slice(0, 12);
      if (bases.length) {
        cachedBases = bases;
        return bases;
      }
    }
  } catch {
    /* liste dynamique indisponible */
  }
  cachedBases = FALLBACK;
  return FALLBACK;
}

export async function resolveViaInvidious(videoId) {
  const bases = await loadInstances();

  for (const base of bases) {
    try {
      const res = await fetch(`${base}/api/v1/videos/${videoId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Sublimilou/1.0)' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) continue;

      const text = await res.text();
      if (!text.startsWith('{')) continue;

      const data = JSON.parse(text);
      const stream =
        data.adaptiveFormats?.find(
          (f) => f.type?.includes('audio') && !f.type?.includes('video') && f.url,
        ) || data.formatStreams?.find((f) => f.type?.includes('audio') && f.url);

      if (!stream?.url) continue;

      return {
        videoId,
        title: data.title || 'Sans titre',
        duration: data.lengthSeconds || 0,
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        mimeType: stream.type?.split(';')[0] || 'audio/mp4',
        streamUrl: stream.url,
        source: 'invidious',
      };
    } catch {
      /* instance suivante */
    }
  }
  return null;
}
