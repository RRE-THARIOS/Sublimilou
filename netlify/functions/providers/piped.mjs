/** Instances publiques Piped — certaines peuvent être hors service. */
const INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.leptons.xyz',
  'https://pipedapi.moomoo.me',
  'https://pipedapi.syncpundit.io',
  'https://pipedapi.in.projectsegfau.lt',
  'https://api-piped.mha.fi',
];

export async function resolveViaPiped(videoId) {
  for (const base of INSTANCES) {
    try {
      const res = await fetch(`${base}/streams/${videoId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Sublimilou/1.0)' },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) continue;

      const raw = await res.text();
      if (!raw.startsWith('{')) continue;
      const data = JSON.parse(raw);
      if (data.message || data.error) continue;
      const stream =
        data.audioStreams?.find((s) => s.mimeType?.includes('audio')) ||
        data.audioStreams?.[0];

      if (!stream?.url) continue;

      return {
        videoId,
        title: data.title || 'Sans titre',
        duration: data.duration || 0,
        thumbnail: data.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        mimeType: stream.mimeType || 'audio/mp4',
        streamUrl: stream.url,
        source: 'piped',
      };
    } catch {
      /* instance suivante */
    }
  }
  return null;
}
