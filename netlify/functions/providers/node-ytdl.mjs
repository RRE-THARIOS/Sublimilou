import ytdl from '@distube/ytdl-core';

export async function resolveViaNodeYtdl(normalizedUrl, videoId) {
  try {
    const info = await ytdl.getInfo(normalizedUrl);
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
    if (/unavailable|private|sign in|age|not available/i.test(msg)) {
      return { unavailable: true };
    }
    return null;
  }
}
