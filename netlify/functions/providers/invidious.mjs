const INSTANCES = [
  'https://yewtu.be',
  'https://invidious.fdn.fr',
  'https://inv.nadeko.net',
  'https://invidious.protokolla.fi',
  'https://invidious.privacydev.net',
];

export async function resolveViaInvidious(videoId) {
  for (const base of INSTANCES) {
    try {
      const res = await fetch(`${base}/api/v1/videos/${videoId}`, {
        headers: { 'User-Agent': 'Sublimilou/1.0' },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) continue;

      const text = await res.text();
      if (text.startsWith('<')) continue;

      const data = JSON.parse(text);
      const stream =
        data.adaptiveFormats?.find((f) => f.type?.includes('audio') && !f.type?.includes('video')) ||
        data.formatStreams?.find((f) => f.type?.includes('audio'));

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
      /* suivant */
    }
  }
  return null;
}
