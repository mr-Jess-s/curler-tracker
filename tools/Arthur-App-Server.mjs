// Serve only the last successfully published build on Arthur's loopback interface.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const stateDirectory = process.env.CT_STATE_DIR || path.join(process.env.LOCALAPPDATA, 'CurlerTracker');
const port = Number(process.env.CT_LOCAL_PORT || 8766);
const privatePaths = new Set(['package.json', 'vercel.json', 'api/curling-io.js']);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' };

http.createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('Cache-Control', 'no-store');
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end(); return;
    }
    const state = JSON.parse(fs.readFileSync(path.join(stateDirectory, 'last-published.json'), 'utf8').replace(/^\uFEFF/, ''));
    const root = fs.realpathSync(state.evidence);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'release.json'), 'utf8'));
    if (manifest.commit !== state.commit) throw new Error('Published build identity mismatch');
    if (url.pathname === '/api/curling-io') {
      const { default: handler } = await import(pathToFileURL(path.join(root, 'api', 'curling-io.js')).href);
      request.query = Object.fromEntries(url.searchParams);
      response.status = code => { response.statusCode = code; return response; };
      response.json = value => { response.setHeader('Content-Type', mime['.json']); response.end(JSON.stringify(value)); };
      response.send = value => response.end(value);
      await handler(request, response); return;
    }
    let relative;
    try { relative = decodeURIComponent(url.pathname.slice(1)) || 'index.html'; }
    catch { response.writeHead(400).end('Invalid URL'); return; }
    if (privatePaths.has(relative) || (relative !== 'release.json' && !Object.hasOwn(manifest.files, relative))) {
      response.writeHead(404).end('Not found'); return;
    }
    const target = fs.realpathSync(path.resolve(root, relative));
    if (!target.startsWith(root + path.sep)) { response.writeHead(404).end('Not found'); return; }
    const body = fs.readFileSync(target);
    response.setHeader('Content-Type', mime[path.extname(target)] || 'application/octet-stream');
    response.setHeader('Content-Length', body.length);
    if (relative.startsWith('data/source-cache/')) response.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600');
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    console.error(new Date().toISOString(), error.message);
    if (!response.headersSent) response.writeHead(503);
    response.end('Published local build temporarily unavailable');
  }
}).listen(port, '127.0.0.1', () => console.log(`Arthur app listening on http://127.0.0.1:${port}`));
