import { execFile } from 'child_process';
import { promisify } from 'util';
import { access, chmod } from 'fs/promises';
import { constants } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { initYtdlpCookies } from '../lib/ytdlp-cookies.mjs';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));

let cachedBinary = null;

export const AUDIO_FORMATS = [
  'bestaudio/best',
  'best/b',
];

/** Node est déjà dans l’image Docker — requis pour les défis YouTube (EJS). */
export function ytdlpBaseArgs() {
  return ['--js-runtimes', 'node'];
}

/**
 * Stratégies ordonnées par probabilité de succès sur IP serveur.
 * tv_embedded et ios fonctionnent SANS cookies — avec cookies YouTube
 * les traite comme un navigateur et applique sa détection bot.
 * useCookies=true seulement pour web/mweb qui en ont besoin.
 */
const CLIENT_STRATEGIES = [
  { args: ['--extractor-args', 'youtube:player_client=tv_embedded'], useCookies: false },
  { args: ['--extractor-args', 'youtube:player_client=ios'], useCookies: false },
  { args: ['--extractor-args', 'youtube:player_client=tv_embedded'], useCookies: true },
  { args: ['--extractor-args', 'youtube:player_client=ios'], useCookies: true },
  { args: ['--extractor-args', 'youtube:player_client=android,web'], useCookies: false },
  { args: ['--extractor-args', 'youtube:player_client=web'], useCookies: true },
  { args: ['--extractor-args', 'youtube:player_client=mweb'], useCookies: true },
  { args: [], useCookies: false },
];

export async function getClientArgSets() {
  return CLIENT_STRATEGIES;
}

/** @deprecated utiliser getClientArgSets() */
export const CLIENT_ARG_SETS = CLIENT_STRATEGIES.map((s) => s.args);

async function fileExists(p) {
  try {
    await access(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function getYtdlpBinary() {
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

export async function cookieArgs() {
  const cookiesPath = initYtdlpCookies() || process.env.YTDLP_COOKIES_PATH;
  if (!cookiesPath) return [];
  try {
    await access(cookiesPath, constants.R_OK);
    return ['--cookies', cookiesPath];
  } catch {
    return [];
  }
}

async function runOnce(binary, url, format, extraArgs, cookies = []) {
  const args = [
    ...ytdlpBaseArgs(),
    '-f',
    format,
    '-j',
    '--no-playlist',
    '--no-warnings',
    '--socket-timeout',
    '20',
    ...cookies,
    ...extraArgs,
    url,
  ];
  const { stdout } = await execFileAsync(binary, args, {
    timeout: 35_000,
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
    const cookies = await cookieArgs();
    const strategies = await getClientArgSets();
    const botBlockedKeys = new Set();
    const BOT_BLOCK_LIMIT = 3;

    for (const format of AUDIO_FORMATS) {
      for (const strategy of strategies) {
        const extra = strategy.args ?? strategy;
        const clientKey = JSON.stringify(extra);
        if (botBlockedKeys.has(clientKey)) continue;
        const usedCookies = (strategy.useCookies ?? true) ? cookies : [];
        try {
          const fmt = await runOnce(binary, normalizedUrl, format, extra, usedCookies);
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
          if (/sign in to confirm|not a bot/i.test(msg)) {
            botBlockedKeys.add(clientKey);
            if (botBlockedKeys.size >= BOT_BLOCK_LIMIT) return { botBlocked: true };
            continue;
          }
          if (/video unavailable|private video|this video is not available|has been removed/i.test(msg)) {
            return { unavailable: true };
          }
          console.error('ytdlp try:', msg.slice(0, 200));
        }
      }
    }
    return { botBlocked: true };
  } catch (err) {
    const msg = String(err.stderr || err.message || err);
    console.error('ytdlp:', msg.slice(0, 400));
    if (/sign in to confirm|not a bot/i.test(msg)) {
      return { botBlocked: true };
    }
    if (/video unavailable|private video|this video is not available|has been removed/i.test(msg)) {
      return { unavailable: true };
    }
    return null;
  }
}
