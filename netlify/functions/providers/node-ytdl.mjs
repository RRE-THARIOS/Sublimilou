import ytdl from '@distube/ytdl-core';

let cachedAgent = null;

function getAgent() {
  if (cachedAgent !== null) return cachedAgent;

  const cookiesRaw = process.env.YOUTUBE_COOKIES_JSON || process.env.YOUTUBE_COOKIES;
  if (!cookiesRaw || cookiesRaw.trim().length < 10) {
    cachedAgent = false;
    return false;
  }

  try {
    let cookies;
    const trimmed = cookiesRaw.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      const parsed = JSON.parse(trimmed);
      cookies = Array.isArray(parsed) ? parsed : parsed.cookies || [];
    } else {
      cookies = trimmed
        .split('\n')
        .filter((l) => l && !l.startsWith('#'))
        .map((line) => {
          const parts = line.split('\t');
          if (parts.length < 7) return null;
          return {
            domain: parts[0],
            name: parts[5],
            value: parts[6],
            path: parts[2] || '/',
          };
        })
        .filter(Boolean);
    }

    if (!cookies.length) {
      cachedAgent = false;
      return false;
    }
    cachedAgent = ytdl.createAgent(cookies);
    console.log('ytdl-core agent: cookies loaded', cookies.length);
    return cachedAgent;
  } catch (err) {
    console.error('ytdl-core agent fail:', err.message);
    cachedAgent = false;
    return false;
  }
}

export async function resolveViaNodeYtdl(normalizedUrl, videoId) {
  try {
    const agent = getAgent();
    const opts = agent ? { agent } : undefined;

    const info = await ytdl.getInfo(normalizedUrl, opts);
    const format = ytdl.chooseFormat(info.formats, {
      quality: 'lowestaudio',
      filter: (f) => f.hasAudio && !f.hasVideo && f.url,
    });
    if (!format?.url?.startsWith('http')) return null;

    const vd = info.videoDetails;
    return {
      videoId,
      title: vd?.title || 'Sans titre',
      duration: parseInt(vd?.lengthSeconds, 10) || 0,
      thumbnail:
        vd?.thumbnails?.slice(-1)[0]?.url ||
        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      mimeType: format.mimeType || 'audio/mp4',
      streamUrl: format.url,
      source: 'ytdl-core',
    };
  } catch (err) {
    const msg = String(err.message || err);
    console.error('ytdl-core:', msg.slice(0, 300));
    if (
      /video unavailable|private video|this video is not available|has been removed|copyright/i.test(
        msg,
      )
    ) {
      return { unavailable: true };
    }
    return null;
  }
}
