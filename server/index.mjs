import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { corsPreflight } from './lib/http.mjs';
import { handleYoutubeResolve } from './handlers/youtube-resolve.mjs';
import { handleYoutubeStream } from './handlers/youtube-stream.mjs';
import { handleTtsBatch } from './handlers/tts-batch.mjs';
import { initYtdlpCookies } from './lib/ytdlp-cookies.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
const PORT = Number(process.env.PORT) || 8080;

initYtdlpCookies();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const rel = decoded.replace(/^\/+/, '') || 'index.html';
  const file = path.normalize(path.join(DIST, rel));
  if (!file.startsWith(DIST)) return null;
  return file;
}

function serveStatic(req, res, url) {
  let file = safePath(url.pathname);
  if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    fs.createReadStream(file).pipe(res);
    return true;
  }

  if (!path.extname(url.pathname)) {
    const index = path.join(DIST, 'index.html');
    if (fs.existsSync(index)) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(index).pipe(res);
      return true;
    }
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    corsPreflight(res);
    return;
  }

  try {
    if (url.pathname === '/api/youtube-resolve') {
      await handleYoutubeResolve(req, res, url);
      return;
    }
    if (url.pathname === '/api/youtube-stream') {
      await handleYoutubeStream(req, res, url);
      return;
    }
    if (url.pathname === '/api/tts-batch') {
      await handleTtsBatch(req, res);
      return;
    }
    if (url.pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, platform: 'fly' }));
      return;
    }

    if (url.pathname.startsWith('/src/')) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }

    if (req.method === 'GET' && serveStatic(req, res, url)) return;

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } catch (err) {
    console.error('server:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Erreur serveur');
    }
  }
});

function assertProductionBuild() {
  const indexFile = path.join(DIST, 'index.html');
  if (!fs.existsSync(indexFile)) {
    console.error('ERREUR: dist/index.html manquant — lance npm run build');
    process.exit(1);
  }
  const html = fs.readFileSync(indexFile, 'utf8');
  if (html.includes('/src/main.js') || !html.includes('/assets/')) {
    console.error(
      'ERREUR: build invalide (index.html non transformé par Vite). Relance npm run build.',
    );
    process.exit(1);
  }
}

if (process.env.NODE_ENV === 'production') {
  assertProductionBuild();
} else if (!fs.existsSync(DIST)) {
  console.warn('⚠ dist/ introuvable — lance npm run build (ou npm run dev + dev:server)');
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Sublimilou → http://localhost:${PORT}`);
  if (process.env.COBALT_API_KEY) console.log('Cobalt API : activé');
  if (process.env.YTDLP_PATH) console.log('yt-dlp :', process.env.YTDLP_PATH);
});
