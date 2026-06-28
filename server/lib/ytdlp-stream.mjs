import { spawn } from 'child_process';
import { promisify } from 'util';
import { execFile } from 'child_process';
import {
  getYtdlpBinary,
  cookieArgs,
  AUDIO_FORMATS,
  getClientArgSets,
  ytdlpBaseArgs,
} from '../providers/ytdlp.mjs';

const execFileAsync = promisify(execFile);

async function jsonProbe(binary, videoUrl, format, extra) {
  const { stdout } = await execFileAsync(
    binary,
    [
      ...ytdlpBaseArgs(),
      '-f',
      format,
      '-j',
      '--no-playlist',
      '--no-warnings',
      ...(await cookieArgs()),
      ...extra,
      videoUrl,
    ],
    { timeout: 45_000, maxBuffer: 4 * 1024 * 1024 },
  );
  return JSON.parse(stdout.trim().split('\n').pop());
}

export async function probeYtdlpByteSize(videoUrl) {
  const binary = await getYtdlpBinary();
  const strategies = await getClientArgSets();
  const cookies = await cookieArgs();

  for (const format of AUDIO_FORMATS) {
    for (const strategy of strategies) {
      const extra = strategy.args ?? strategy;
      const usedCookies = (strategy.useCookies ?? true) ? cookies : [];
      try {
        const fmt = await jsonProbe(binary, videoUrl, format, [...usedCookies, ...extra]);
        const size = Number(fmt?.filesize || fmt?.filesize_approx || 0);
        if (size > 0) return size;
      } catch {
        /* combinaison suivante */
      }
    }
  }
  return 0;
}

function attemptPipe(binary, videoUrl, format, extra, cookies, res, mimeType) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      binary,
      [
        ...ytdlpBaseArgs(),
        '-f',
        format,
        '-o',
        '-',
        '--no-playlist',
        '--no-warnings',
        '--socket-timeout',
        '20',
        ...cookies,
        ...extra,
        videoUrl,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let stderr = '';
    let started = false;
    const timer = setTimeout(() => {
      if (!started) {
        child.kill();
        reject(new Error(stderr.slice(0, 300) || 'yt-dlp timeout'));
      }
    }, 60_000);

    child.stderr.on('data', (c) => {
      stderr += c;
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.stdout.once('data', (chunk) => {
      started = true;
      clearTimeout(timer);
      res.writeHead(200, {
        'Content-Type': mimeType,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers':
          'Content-Length, Content-Range, Accept-Ranges, X-Sublimilou-Mode',
        'X-Sublimilou-Mode': 'ytdlp-pipe',
        'Cache-Control': 'no-store',
      });
      res.write(chunk);
      child.stdout.pipe(res);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && started) resolve();
      else if (!started) reject(new Error(stderr.slice(0, 300) || `yt-dlp exit ${code}`));
      else if (code !== 0) reject(new Error(stderr.slice(0, 300) || `yt-dlp exit ${code}`));
    });
  });
}

/** Flux audio complet via yt-dlp (fallback si googlevideo refuse le proxy). */
export async function pipeYtdlpAudio(res, videoUrl, mimeType = 'audio/mp4') {
  const binary = await getYtdlpBinary();
  const cookies = await cookieArgs();
  const strategies = await getClientArgSets();
  let lastErr = 'yt-dlp pipe failed';
  const botBlockedKeys = new Set();
  const BOT_BLOCK_LIMIT = 3;

  for (const format of AUDIO_FORMATS) {
    for (const strategy of strategies) {
      const extra = strategy.args ?? strategy;
      const clientKey = JSON.stringify(extra);
      if (botBlockedKeys.has(clientKey)) continue;
      const usedCookies = (strategy.useCookies ?? true) ? cookies : [];
      try {
        await attemptPipe(binary, videoUrl, format, extra, usedCookies, res, mimeType);
        return;
      } catch (err) {
        lastErr = String(err.message || err);
        if (res.headersSent) throw err;
        if (/sign in to confirm|not a bot/i.test(lastErr)) {
          botBlockedKeys.add(clientKey);
          if (botBlockedKeys.size >= BOT_BLOCK_LIMIT) {
            throw new Error('YouTube bloque le téléchargement depuis ce serveur.');
          }
          continue;
        }
      }
    }
  }

  console.error('ytdlp pipe:', lastErr);
  throw new Error(lastErr);
}

/** Réponse 206 pour la sonde Range bytes=0-0 du client. */
export async function respondYtdlpRangeProbe(res, videoUrl, mimeType) {
  const total = await probeYtdlpByteSize(videoUrl);
  if (!total) {
    res.writeHead(200, {
      'Content-Type': mimeType,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers':
        'Content-Length, Content-Range, Accept-Ranges, X-Sublimilou-Mode',
      'X-Sublimilou-Mode': 'ytdlp-pipe',
    });
    res.end();
    return;
  }

  res.writeHead(206, {
    'Content-Type': mimeType,
    'Content-Range': `bytes 0-0/${total}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': '1',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers':
      'Content-Length, Content-Range, Accept-Ranges, X-Sublimilou-Mode',
    'X-Sublimilou-Mode': 'ytdlp-pipe',
  });
  res.end(Buffer.alloc(1));
}
