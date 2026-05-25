export async function resolveViaCobalt(youtubeUrl) {
  const base = process.env.COBALT_API_URL || 'https://api.cobalt.tools';
  const apiKey = process.env.COBALT_API_KEY;

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (apiKey) {
    headers.Authorization = apiKey.startsWith('Bearer ') || apiKey.startsWith('ApiKey ')
      ? apiKey
      : `ApiKey ${apiKey}`;
  }

  const res = await fetch(`${base.replace(/\/$/, '')}/`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      url: youtubeUrl,
      downloadMode: 'audio',
      audioFormat: 'best',
      filenameStyle: 'basic',
    }),
    signal: AbortSignal.timeout(25_000),
  });

  if (!res.ok) return null;

  const data = await res.json();
  const streamUrl =
    data.url ||
    data.audioUrl ||
    (data.status === 'tunnel' || data.status === 'redirect' ? data.url : null);

  if (!streamUrl) return null;

  return {
    title: data.filename || 'Sans titre',
    duration: 0,
    thumbnail: null,
    mimeType: 'audio/mp4',
    streamUrl,
    source: 'cobalt',
  };
}
