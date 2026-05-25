/** Instances publiques Piped — certaines peuvent être hors service. */
const INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://api-piped.mha.fi',
  'https://pipedapi.leptons.xyz',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.tokhmi.xyz',
  'https://pipedapi.moomoo.me',
  'https://pipedapi.syncpundit.io',
];

export async function resolveViaPiped(videoId) {
  for (const base of INSTANCES) {
    try {
      const res = await fetch(`${base}/streams/${videoId}`, {
        headers: { 'User-Agent': 'Sublimilou/1.0' },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) continue;

      const data = await res.json();
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
