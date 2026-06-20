const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Range, X-Youtube-Url, X-Sublimilou-Youtube-Url',
};

export function sendJson(res, body, status = 200) {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export function sendText(res, text, status = 200, extra = {}) {
  res.writeHead(status, { ...CORS, 'Content-Type': 'text/plain; charset=utf-8', ...extra });
  res.end(text);
}

export function corsPreflight(res) {
  res.writeHead(204, CORS);
  res.end();
}

export async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function readJson(req) {
  const raw = await readBody(req);
  if (!raw.length) return null;
  return JSON.parse(raw.toString('utf8'));
}
