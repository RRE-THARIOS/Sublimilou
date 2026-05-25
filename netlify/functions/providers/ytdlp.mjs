import { execFile } from 'child_process';
import { promisify } from 'util';
import { access, chmod } from 'fs/promises';
import { constants } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const ytdlpDir = path.dirname(fileURLToPath(import.meta.url));

let cachedBinary = null;

async function fileExists(p) {
  try {
    await access(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function getYtdlpBinary() {
  if (cachedBinary) return cachedBinary;

  const envPath = process.env.YTDLP_PATH;
  const candidates = [
    envPath && path.isAbsolute(envPath) ? envPath : envPath && path.join(process.cwd(), envPath),
    path.join(ytdlpDir, '../../bin/yt-dlp'),
    '/opt/homebrew/bin/yt-dlp',
    '/usr/local/bin/yt-dlp',
    path.join('/tmp', 'yt-dlp'),
  ].filter(Boolean);

  for (const bin of candidates) {
    if (await fileExists(bin)) {
      cachedBinary = bin;
      return bin;
    }
  }

  const tmpBin = path.join('/tmp', 'yt-dlp');
  if (!(await fileExists(tmpBin))) {
    const platform = os.platform() === 'darwin' ? 'macos' : 'linux';
    const { default: YTDlpWrap } = await import('yt-dlp-wrap');
    await YTDlpWrap.downloadFromGithub(tmpBin, platform);
    await chmod(tmpBin, 0o755);
  }
  cachedBinary = tmpBin;
  return tmpBin;
}

async function getMetadata(binary, url) {
  const { stdout } = await execFileAsync(
    binary,
    ['--dump-single-json', '--no-playlist', '--no-warnings', url],
    { timeout: 45_000, maxBuffer: 4 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}

async function getAudioUrl(binary, url) {
  const { stdout } = await execFileAsync(
    binary,
    [
      '-f',
      'ba/b',
      '--get-url',
      '--no-playlist',
      '--no-warnings',
      url,
    ],
    { timeout: 45_000, maxBuffer: 1024 * 1024 },
  );
  return stdout.trim().split('\n')[0];
}

export async function resolveViaYtdlp(normalizedUrl, videoId) {
  try {
    const binary = await getYtdlpBinary();
    const [meta, streamUrl] = await Promise.all([
      getMetadata(binary, normalizedUrl),
      getAudioUrl(binary, normalizedUrl),
    ]);

    if (!streamUrl?.startsWith('http')) return null;

    return {
      videoId,
      title: meta.title || 'Sans titre',
      duration: meta.duration || 0,
      thumbnail:
        meta.thumbnail ||
        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      mimeType: 'audio/mp4',
      streamUrl,
      source: 'ytdlp',
    };
  } catch (err) {
    const msg = String(err.stderr || err.message || err);
    console.error('ytdlp:', msg.slice(0, 400));
    if (/video unavailable|private video|sign in to confirm|age.restricted|not available/i.test(msg)) {
      return { unavailable: true };
    }
    return null;
  }
}
