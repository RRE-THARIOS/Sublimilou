/** Même logique que le serveur — corrige ww.youtube, liens sans https, m.youtube → www, nettoie les paramètres playlist. */
export function normalizeYoutubeUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  s = s.replace(/^ww\./i, 'www.');
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\./, '');
    if (!['youtube.com', 'youtu.be', 'm.youtube.com', 'music.youtube.com'].includes(host)) {
      return null;
    }
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0]?.slice(0, 11);
      if (!id) return null;
      return `https://www.youtube.com/watch?v=${id}`;
    }
    if (u.pathname.startsWith('/shorts/')) {
      const id = u.pathname.split('/')[2]?.slice(0, 11);
      if (!id) return null;
      return `https://www.youtube.com/watch?v=${id}`;
    }
    if (u.pathname.startsWith('/live/')) {
      const id = u.pathname.split('/')[2]?.slice(0, 11);
      if (!id) return null;
      return `https://www.youtube.com/watch?v=${id}`;
    }
    const id = u.searchParams.get('v')?.slice(0, 11);
    if (!id) return null;
    return `https://www.youtube.com/watch?v=${id}`;
  } catch {
    return null;
  }
}

export function extractVideoId(url) {
  const normalized = normalizeYoutubeUrl(url);
  if (!normalized) return null;
  try {
    const u = new URL(normalized);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0]?.slice(0, 11);
    if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2]?.slice(0, 11);
    return u.searchParams.get('v')?.slice(0, 11) || null;
  } catch {
    return null;
  }
}
