import { execFile } from 'child_process';
import { promisify } from 'util';
import { access, chmod } from 'fs/promises';
import { constants } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));

let cachedBinary = null;

const CLIENT_ARG_SETS = [
  [],
  ['--extractor-args', 'youtube:player_client=tv_embedded'],
];

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

  const cwd = process.cwd();
  const envPath = process.env.YTDLP_PATH;
  const candidates = [
    envPath && (path.isAbsolute(envPath) ? envPath : path.join(cwd, envPath)),
    path.join(cwd, 'netlify', 'functions', 'bin', 'yt-dlp'),
    path.join(here, '../../bin/yt-dlp'),
    '/var/task/netlify/functions/bin/yt-dlp',
    '/opt/homebrew/bin/yt-dlp',
    '/usr/local/bin/yt-dlp',
    path.join('/tmp', 'yt-dlp'),
  ].filter(Boolean);

  for (const bin of candidates) {
    if (await fileExists(bin)) {
      cachedBinary = bin;
      console.log('ytdlp binary:', bin);
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
  console.log('ytdlp binary (tmp):', tmpBin);
  return tmpBin;
}

async function runOnce(binary, url, extraArgs) {
  const args = [
    '-f',
    'ba/b',
    '-j',
    '--no-playlist',
    '--no-warnings',
    '--socket-timeout',
    '15',
    ...extraArgs,
    url,
  ];
  const { stdout } = await execFileAsync(binary, args, {
    timeout: 22_000,
    maxBuffer: 3 * 1024 * 1024,
  });
  const line = stdout.trim().split('\n').pop();
  const fmt = JSON.parse(line);
  if (!fmt?.url?.startsWith('http')) return null;
  return fmt;
}

export async function resolveViaYtdlp(normalizedUrl, videoId) {
  try {
    const binary = await getYtdlpBinary();

    for (const extra of CLIENT_ARG_SETS) {
      try {
        const fmt = await runOnce(binary, normalizedUrl, extra);
        if (!fmt?.url) continue;

        return {
          videoId,
          title: fmt.title || fmt.fulltitle || 'Sans titre',
          duration: fmt.duration || 0,
          thumbnail:
            fmt.thumbnail ||
            `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          mimeType: fmt.ext === 'webm' ? 'audio/webm' : 'audio/mp4',
          streamUrl: fmt.url,
          source: 'ytdlp',
        };
      } catch (inner) {
        const msg = String(inner.stderr || inner.message || inner);
        if (/video unavailable|private video|sign in to confirm|age.restricted/i.test(msg)) {
          return { unavailable: true };
        }
        console.error('ytdlp try:', msg.slice(0, 200));
      }
    }
    return null;
  } catch (err) {
    const msg = String(err.stderr || err.message || err);
    console.error('ytdlp:', msg.slice(0, 400));
    if (/video unavailable|private video|sign in to confirm|age.restricted|not available/i.test(msg)) {
      return { unavailable: true };
    }
    return null;
  }
}
