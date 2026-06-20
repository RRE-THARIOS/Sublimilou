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
        .slice(0, 5);
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
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) continue;

      const text = await res.text();
      if (!text.startsWith('{')) continue;

      const data = JSON.parse(text);
      // Préférer adaptiveFormats audio-only, sinon formatStreams
      const stream =
        data.adaptiveFormats?.find(
          (f) => f.type?.includes('audio') && !f.type?.includes('video') && f.itag,
        ) || data.formatStreams?.find((f) => f.type?.includes('audio') && f.itag);

      if (!stream?.itag) continue;

      // Utiliser le proxy Invidious (/latest_version?local=true) pour éviter les URL
      // googlevideo.com verrouillées sur l'IP du serveur Invidious.
      // Invidious sert CORS (Access-Control-Allow-Origin: *) sur cet endpoint,
      // donc le browser peut télécharger directement.
      const streamUrl = `${base}/latest_version?id=${videoId}&itag=${stream.itag}&local=true`;

      return {
        videoId,
        title: data.title || 'Sans titre',
        duration: data.lengthSeconds || 0,
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        mimeType: stream.type?.split(';')[0] || 'audio/mp4',
        streamUrl,
        source: 'invidious',
        directOk: true,
      };
    } catch {
      /* instance suivante */
    }
  }
  return null;
}
