import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.PORT || 8787);
const USER_AGENT = process.env.CURLER_TRACKER_UA || 'CurlerTracker/1.0 (+https://example.local)';
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 15000);
const PAGE_CACHE_TTL_MS = Number(process.env.PAGE_CACHE_TTL_MS || 300000);
const SEARCH_CACHE_TTL_MS = Number(process.env.SEARCH_CACHE_TTL_MS || 120000);
const MAX_PAGES = Number(process.env.MAX_PAGES || 18);
const MAX_LINKS_PER_PAGE = Number(process.env.MAX_LINKS_PER_PAGE || 12);
const BASES = [
  'https://www.curlingzone.com/scoreboard.php',
  'https://home.curlingzone.com/'
];

const pageCache = new Map();
const searchCache = new Map();

function nowMs() { return Date.now(); }
function normalizeName(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9#]+/g, ' ')
    .trim();
}
function splitParts(value = '') { return normalizeName(value).split(' ').filter(Boolean); }
function computeMatchScore(search, candidate) {
  const s = normalizeName(search);
  const c = normalizeName(candidate);
  if (!s || !c) return 0;
  if (s === c) return 100;
  if (s.includes(c) || c.includes(s)) return 75;
  const cSet = new Set(splitParts(c));
  const overlap = splitParts(s).filter(part => cSet.has(part));
  if (overlap.length >= 2) return 50;
  if (overlap.length === 1) return 25;
  return 0;
}

function getCached(map, key) {
  const hit = map.get(key);
  if (!hit) return null;
  if (hit.expiresAt < nowMs()) { map.delete(key); return null; }
  return hit.value;
}
function setCached(map, key, value, ttlMs) { map.set(key, { value, expiresAt: nowMs() + ttlMs }); }

async function fetchText(url) {
  const cached = getCached(pageCache, url);
  if (cached) return cached;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,*/*' }, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const text = await res.text();
    setCached(pageCache, url, text, PAGE_CACHE_TTL_MS);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function parseLinks(html, baseUrl) {
  const out = [];
  const regex = /href=["']([^"'#]+)["']/gi;
  let match;
  while ((match = regex.exec(html))) {
    try {
      const url = new URL(match[1], baseUrl).toString();
      if (/curlingzone\.com/i.test(url) && !out.includes(url)) out.push(url);
    } catch {}
    if (out.length >= MAX_LINKS_PER_PAGE) break;
  }
  return out;
}

function extractDates(text) {
  const dates = [];
  const regex = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,\s+\d{4})?/gi;
  let match;
  while ((match = regex.exec(text))) dates.push(match[0]);
  return dates;
}

function inferFinish(text) {
  const t = normalizeName(text);
  if (/champion|winner/.test(t)) return 'Champion';
  if (/finalist|runner up/.test(t)) return 'Finalist';
  if (/semifinal/.test(t)) return 'Semifinalist';
  if (/quarterfinal/.test(t)) return 'Quarterfinalist';
  if (/round robin/.test(t)) return 'Exited round robin';
  return 'Result not fully determined';
}

function extractRowsFromText(player, text, sourceUrl) {
  const lines = text.split(/\r?\n/).map(line => line.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const searchNorm = normalizeName(player);
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const score = computeMatchScore(player, line);
    if (!score) continue;
    const window = lines.slice(Math.max(0, i - 4), Math.min(lines.length, i + 8));
    const joined = window.join(' · ');
    const dates = extractDates(joined);
    const eventName = window.find(x => /bonspiel|classic|open|cup|slam|challenge|trophy|championship|cashspiel|spiel/i.test(x)) || 'CurlingZone event';
    const teamName = window.find(x => /team\s+/i.test(x)) || line;
    const opponentName = window.find(x => /\bvs\b|\bv\b/i.test(x)) || 'TBD';
    const state = /live|in progress|playing/i.test(joined) ? 'Live' : /scheduled|draw/i.test(joined) ? 'Scheduled' : /final|complete/i.test(joined) ? 'Complete' : 'Unknown';
    rows.push({
      eventId: `${normalizeName(eventName)}|${dates[0] || ''}`,
      eventName,
      teamName,
      matchedTeam: teamName,
      matchedCurler: line,
      matchScore: score,
      opponentName: opponentName.replace(/^.*?(?:vs|v)\s+/i, '').trim() || 'TBD',
      teamScore: 0,
      opponentScore: 0,
      state,
      startsAt: dates[0] || null,
      startDate: dates[0] || null,
      endDate: dates[1] || dates[0] || null,
      finish: inferFinish(joined),
      sourceUrl
    });
  }
  return rows;
}

async function discoverRows(player) {
  const cached = getCached(searchCache, player);
  if (cached) return cached;
  const queue = [...BASES];
  const visited = new Set();
  const rows = [];
  while (queue.length && visited.size < MAX_PAGES) {
    const url = queue.shift();
    if (!url || visited.has(url)) continue;
    visited.add(url);
    try {
      const html = await fetchText(url);
      rows.push(...extractRowsFromText(player, html, url));
      for (const link of parseLinks(html, url)) if (!visited.has(link)) queue.push(link);
    } catch {}
  }
  const dedup = new Map();
  for (const row of rows) {
    const key = `${row.eventId}|${normalizeName(row.matchedTeam)}|${normalizeName(row.matchedCurler)}|${normalizeName(row.opponentName)}`;
    if (!dedup.has(key) || Number(row.matchScore || 0) > Number(dedup.get(key).matchScore || 0)) dedup.set(key, row);
  }
  const out = { player, rows: Array.from(dedup.values()).slice(0, 100), meta: { searchedAt: new Date().toISOString(), pagesVisited: visited.size } };
  setCached(searchCache, player, out, SEARCH_CACHE_TTL_MS);
  return out;
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,OPTIONS'
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return writeJson(res, 204, {});
  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
  if (reqUrl.pathname === '/healthz') return writeJson(res, 200, { ok: true, service: 'curlingzone-proxy', time: new Date().toISOString() });
  if (reqUrl.pathname !== '/api/curlingzone/search') return writeJson(res, 404, { error: 'Not found' });
  const player = (reqUrl.searchParams.get('player') || '').trim();
  if (!player) return writeJson(res, 400, { error: 'Missing player query parameter' });
  try {
    const payload = await discoverRows(player);
    return writeJson(res, 200, payload);
  } catch (error) {
    return writeJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`CurlingZone proxy listening on ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/healthz`);
  console.log(`Search:  http://localhost:${PORT}/api/curlingzone/search?player=Kevin%20Koe`);
});
