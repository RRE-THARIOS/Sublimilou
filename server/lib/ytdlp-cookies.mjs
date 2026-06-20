import fs from 'fs';

const DEFAULT_PATH = '/tmp/youtube-cookies.txt';

/** Prépare le fichier cookies pour yt-dlp (chemin local ou secret Fly base64). */
export function initYtdlpCookies() {
  const explicit = process.env.YTDLP_COOKIES_PATH?.trim();
  if (explicit && fs.existsSync(explicit)) {
    return explicit;
  }

  const b64 = process.env.YTDLP_COOKIES_B64?.trim();
  if (!b64) return explicit || null;

  try {
    const text = Buffer.from(b64, 'base64').toString('utf8');
    if (!text.includes('youtube.com') && !text.includes('.youtube\t')) {
      console.warn('ytdlp cookies: fichier décodé sans domaine youtube — vérifie l’export');
    }
    fs.writeFileSync(DEFAULT_PATH, text, { mode: 0o600 });
    process.env.YTDLP_COOKIES_PATH = DEFAULT_PATH;
    console.log('ytdlp cookies: chargés depuis YTDLP_COOKIES_B64');
    return DEFAULT_PATH;
  } catch (err) {
    console.error('ytdlp cookies: YTDLP_COOKIES_B64 invalide', err.message);
    return null;
  }
}

/** En-tête Cookie pour fetch() vers googlevideo (même fichier que yt-dlp). */
export function readCookieHeader() {
  const cookiesPath = initYtdlpCookies();
  if (!cookiesPath || !fs.existsSync(cookiesPath)) return '';

  const pairs = [];
  for (const line of fs.readFileSync(cookiesPath, 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('\t');
    if (parts.length < 7) continue;
    const domain = parts[0];
    if (!/youtube\.com|\.google\.com/i.test(domain)) continue;
    pairs.push(`${parts[5]}=${parts[6]}`);
  }
  return pairs.join('; ');
}
