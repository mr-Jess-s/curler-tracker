import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.PORT || 10000);
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const USER_AGENT = process.env.CURLER_TRACKER_UA || 'CurlerTracker/1.0 (+https://example.local)';
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

function normalizeName(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9#]+/g, ' ')
    .trim();
}

function decodeEntities(text = '') {
  return String(text)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripHtml(html = '') {
  return decodeEntities(
    String(html)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\r/g, '\n')
      .replace(/\t/g, ' ')
      .replace(/[ ]{2,}/g, ' ')
  );
}

function computeNameMatchScore(candidateName, playerNorm) {
  const norm = normalizeName(candidateName);
  if (!norm || !playerNorm) return 0;
  if (norm === playerNorm) return 100;
  if (norm.includes(playerNorm) || playerNorm.includes(norm)) return 75;
  const normParts = new Set(norm.split(' ').filter(Boolean));
  const overlap = playerNorm.split(' ').filter(Boolean).filter(part => normParts.has(part));
  if (overlap.length >= 2) return 50;
  if (overlap.length === 1) return 25;
  return 0;
}

function extractSurnameTeamName(line = '') {
  const clean = line.replace(/\s+/g, ' ').trim();
  const match = clean.match(/(.+?)\s*\(([^()]+)\)\s*$/);
  if (!match) return { teamName: clean, matchedCurler: clean };
  return {
    teamName: `${match[1].trim()} (${match[2].trim()})`,
    matchedCurler: match[2].trim()
  };
}

function findContext(lines, index, predicate, step, limit = 10) {
  for (let i = 1; i <= limit; i++) {
    const value = lines[index + i * step];
    if (!value) continue;
    if (predicate(value)) return value;
  }
  return '';
}

function parseDateish(value = '') {
  const text = value.replace(/^Draw:\s*/i, '').trim();
  const dt = Date.parse(text);
  return Number.isNaN(dt) ? null : dt;
}

function dedupeRows(rows) {
  const out = new Map();
  for (const row of rows) {
    const key = [
      row.eventId,
      normalizeName(row.matchedTeam),
      normalizeName(row.opponentName),
      row.drawLabel || '',
      row.startsAt || ''
    ].join('|');
    if (!out.has(key)) out.set(key, row);
  }
  return [...out.values()];
}

function parseRowsFromText(text, player, sourceUrl) {
  const lines = stripHtml(text)
    .split('\n')
    .map(v => v.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const playerNorm = normalizeName(player);
  const rows = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNorm = normalizeName(lines[i]);
    if (!lineNorm) continue;
    if (!(lineNorm.includes(playerNorm) || playerNorm.split(' ').some(part => part && lineNorm.includes(part)))) continue;

    const eventName =
      findContext(lines, i, v => /teams\s*\|\s*scores\s*\|\s*standings\s*\|\s*playoffs/i.test(v), -1, 6) ||
      findContext(lines, i, v => /draw\s*:/i.test(v), -1, 8) ||
      'CurlingZone Event';

    const drawLine = findContext(lines, i, v => /draw\s*:/i.test(v), -1, 8);
    const timeLine = drawLine || findContext(lines, i, v => /\b(?:mon|tue|wed|thu|fri|sat|sun)\b/i.test(v), -1, 8);
    const finalLine = findContext(lines, i, v => /^(final|live|scheduled|complete)/i.test(v), 1, 8);
    const scoreLine = findContext(lines, i, v => /^\d+$/.test(v) || /^\d+\s+final/i.test(v), 1, 6);
    const opponentLine =
      findContext(lines, i, v => normalizeName(v) !== lineNorm && /\(|[A-Za-z]/.test(v), 2, 6) ||
      findContext(lines, i, v => normalizeName(v) !== lineNorm && /\(|[A-Za-z]/.test(v), -2, 6);

    const teamInfo = extractSurnameTeamName(lines[i]);
    const oppInfo = extractSurnameTeamName(opponentLine || 'TBD');

    const matchScore = Math.max(
      computeNameMatchScore(teamInfo.matchedCurler, playerNorm),
      computeNameMatchScore(teamInfo.teamName, playerNorm)
    );
    if (!matchScore) continue;

    rows.push({
      eventId: normalizeName(eventName).replace(/\s+/g, '-'),
      eventName,
      matchedCurler: teamInfo.matchedCurler,
      matchedTeam: teamInfo.teamName,
      teamName: teamInfo.teamName,
      opponentName: oppInfo.teamName,
      drawLabel: drawLine.replace(/^Draw:\s*/i, '').split('--')[0]?.trim() || null,
      startsAt: timeLine || null,
      epochMs: parseDateish(timeLine || ''),
      gameTitle: '',
      state: finalLine || 'Complete',
      stateLabel: finalLine || 'Complete',
      teamScore: /^\d+$/.test(scoreLine) ? Number(scoreLine) : 0,
      opponentScore: 0,
      result: '',
      matchScore,
      sourceUrl
    });
  }

  return dedupeRows(rows);
}

async function fetchText(url) {
  const cached = pageCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.text;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*' },
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`CurlingZone HTTP ${res.status} for ${url}`);
    const text = await res.text();
    pageCache.set(url, { text, expiresAt: Date.now() + PAGE_CACHE_TTL_MS });
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function extractLinks(html, baseUrl) {
  const found = new Set();
  const regex = /href\s*=\s*["']([^"'#]+)["']/gi;
  let match;
  while ((match = regex.exec(html))) {
    try {
      const absolute = new URL(match[1], baseUrl).toString();
      if (/curlingzone\.com/i.test(absolute)) found.add(absolute);
    } catch {}
    if (found.size >= MAX_LINKS_PER_PAGE) break;
  }
  return [...found];
}

async function scrapeCurlingZone(player) {
  const cacheKey = normalizeName(player);
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.payload;

  const queue = [...BASES];
  const seen = new Set();
  const rows = [];

  while (queue.length && seen.size < MAX_PAGES) {
    const url = queue.shift();
    if (!url || seen.has(url)) continue;
    seen.add(url);

    const html = await fetchText(url);
    rows.push(...parseRowsFromText(html, player, url));

    for (const link of extractLinks(html, url)) {
      if (!seen.has(link)) queue.push(link);
      if (queue.length >= MAX_PAGES) break;
    }
  }

  const payload = {
    rows: dedupeRows(rows),
    scrapedAt: new Date().toISOString(),
    pagesVisited: seen.size
  };

  searchCache.set(cacheKey, {
    payload,
    expiresAt: Date.now() + SEARCH_CACHE_TTL_MS
  });

  return payload;
}

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': ALLOW_ORIGIN,
    'access-control-allow-methods': 'GET,OPTIONS',
    'access-control-allow-headers': 'content-type'
  });
  res.end(JSON.stringify(body, null, 2));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/healthz') {
    return json(res, 200, {
      ok: true,
      service: 'curler-tracker-curlingzone-proxy',
      now: new Date().toISOString()
    });
  }

  if (url.pathname === '/') {
    return json(res, 200, {
      ok: true,
      service: 'curler-tracker-curlingzone-proxy',
      endpoints: {
        health: '/healthz',
        search: '/api/curlingzone/search?player=Kevin%20Koe'
      }
    });
  }

  if (url.pathname !== '/api/curlingzone/search') {
    return json(res, 404, { error: 'Not found' });
  }

  const player = url.searchParams.get('player')?.trim() || '';
  if (!player) {
    return json(res, 400, { error: 'Missing player parameter' });
  }

  try {
    const payload = await scrapeCurlingZone(player);
    return json(res, 200, payload);
  } catch (error) {
    return json(res, 502, { error: error.message, rows: [] });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`CurlingZone proxy listening on ${PORT}`);
});