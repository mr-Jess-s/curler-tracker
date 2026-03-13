import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.PORT || 10000);
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const USER_AGENT = process.env.CURLER_TRACKER_UA || 'CurlerTracker/1.0 (+https://example.local)';
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 15000);
const PAGE_CACHE_TTL_MS = Number(process.env.PAGE_CACHE_TTL_MS || 5 * 60 * 1000);
const SEARCH_CACHE_TTL_MS = Number(process.env.SEARCH_CACHE_TTL_MS || 2 * 60 * 1000);
const MAX_PAGES = Number(process.env.MAX_PAGES || 24);
const MAX_LINKS_PER_PAGE = Number(process.env.MAX_LINKS_PER_PAGE || 18);

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

function unique(values) {
  return [...new Set(values.filter(Boolean))];
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
      .replace(/<\/tr>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
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

function parseDateish(value = '') {
  const text = value.replace(/^Draw:\s*/i, '').trim();
  const dt = Date.parse(text);
  return Number.isNaN(dt) ? null : dt;
}

function slugify(text = '') {
  return normalizeName(text).replace(/\s+/g, '-');
}

function extractSurnameTeamName(line = '') {
  const clean = String(line).replace(/\s+/g, ' ').trim();
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

function dedupeRows(rows) {
  const out = new Map();
  for (const row of rows) {
    const key = [
      row.eventId || '',
      normalizeName(row.matchedTeam),
      normalizeName(row.opponentName),
      row.drawLabel || '',
      row.startsAt || '',
      row.sourceUrl || ''
    ].join('|');
    const prior = out.get(key);
    if (!prior || (row.matchScore || 0) > (prior.matchScore || 0)) out.set(key, row);
  }
  return [...out.values()];
}

function buildPlayerTerms(player) {
  const playerNorm = normalizeName(player);
  const parts = playerNorm.split(' ').filter(Boolean);
  const terms = unique([playerNorm, ...parts.filter(p => p.length >= 3)]);
  return { playerNorm, terms };
}

function buildLines(text = '') {
  return stripHtml(text)
    .split('\n')
    .map(v => v.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function linesContainPlayer(lines, terms) {
  const normalizedLines = lines.map(normalizeName);
  return normalizedLines.some(line => terms.some(term => term && line.includes(term)));
}

function extractLinks(html, baseUrl) {
  const results = [];
  const regex = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(html))) {
    try {
      const href = new URL(match[1], baseUrl).toString();
      if (!/curlingzone\.com/i.test(href)) continue;
      const anchorText = stripHtml(match[2]).replace(/\s+/g, ' ').trim();
      results.push({ href, text: anchorText, normText: normalizeName(anchorText) });
      if (results.length >= 200) break;
    } catch {}
  }
  return results;
}

function classifyLink(href = '', anchorText = '') {
  const h = href.toLowerCase();
  const t = normalizeName(anchorText);
  const isRoster = /roster|lineup|team/i.test(h) || /roster|lineup|team/.test(t);
  const isGame = /gameid=|draw|scoreboard|scores/i.test(h) || /scores|draw|live|schedule/.test(t);
  const isEvent = /eventid=|event\b|standings|playoffs/i.test(h) || /standings|playoffs|teams|event/.test(t);
  return { isRoster, isGame, isEvent };
}

function scoreDiscoveredLink(link, terms) {
  const { href, normText } = link;
  const { isRoster, isGame, isEvent } = classifyLink(href, normText);
  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    if (normText.includes(term)) score += term.length >= 5 ? 8 : 3;
    if (normalizeName(href).includes(term)) score += term.length >= 5 ? 6 : 2;
  }
  if (isRoster) score += 30;
  else if (isGame) score += 16;
  else if (isEvent) score += 10;
  if (/teamid=|team\.php|team\//i.test(href)) score += 18;
  if (/playerid=|player\//i.test(href)) score += 12;
  return score;
}

function extractRosterContext(html, sourceUrl, terms) {
  const links = extractLinks(html, sourceUrl);
  const ranked = links
    .map(link => ({ ...link, score: scoreDiscoveredLink(link, terms) }))
    .filter(link => link.score > 0)
    .sort((a, b) => b.score - a.score || a.href.length - b.href.length);

  const seen = new Set();
  const selected = [];
  for (const link of ranked) {
    if (seen.has(link.href)) continue;
    seen.add(link.href);
    selected.push(link);
    if (selected.length >= MAX_LINKS_PER_PAGE) break;
  }
  return selected;
}

function rosterRowsFromPage(html, player, sourceUrl) {
  const { playerNorm, terms } = buildPlayerTerms(player);
  const lines = buildLines(html);
  if (!linesContainPlayer(lines, terms)) return [];

  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNorm = normalizeName(line);
    if (!terms.some(term => term && lineNorm.includes(term))) continue;

    const teamLine = findContext(lines, i, v => /team|roster|lineup|club/i.test(v), -1, 6)
      || findContext(lines, i, v => /\([^)]+\)$/.test(v), -1, 4)
      || findContext(lines, i, v => /\([^)]+\)$/.test(v), 1, 4)
      || line;

    const eventLine = findContext(lines, i, v => /standings|scores|playoffs|draw|event/i.test(v), -1, 10)
      || findContext(lines, i, v => /curlingzone/i.test(v), -1, 12)
      || 'CurlingZone Team Page';

    const drawLine = findContext(lines, i, v => /draw\s*:/i.test(v), 1, 10)
      || findContext(lines, i, v => /draw\s*:/i.test(v), -1, 10)
      || null;

    const startsAt = drawLine || findContext(lines, i, v => /\b(?:mon|tue|wed|thu|fri|sat|sun)\b/i.test(v), 1, 10) || null;
    const teamInfo = extractSurnameTeamName(teamLine);
    const matchScore = Math.max(
      computeNameMatchScore(line, playerNorm),
      computeNameMatchScore(teamInfo.matchedCurler, playerNorm),
      computeNameMatchScore(teamInfo.teamName, playerNorm)
    );
    if (!matchScore) continue;

    rows.push({
      eventId: slugify(eventLine || teamInfo.teamName || 'curlingzone-team-page'),
      eventName: eventLine || 'CurlingZone Team Page',
      matchedCurler: matchScore >= 75 ? player : teamInfo.matchedCurler || player,
      matchedTeam: teamInfo.teamName || teamLine,
      teamName: teamInfo.teamName || teamLine,
      opponentName: 'TBD',
      drawLabel: drawLine ? drawLine.replace(/^Draw:\s*/i, '').trim() : null,
      startsAt,
      epochMs: parseDateish(startsAt || ''),
      gameTitle: '',
      state: 'Roster',
      stateLabel: 'Roster',
      teamScore: 0,
      opponentScore: 0,
      result: '',
      matchScore,
      sourceUrl,
      discoveryType: 'team-page-roster'
    });
  }

  return dedupeRows(rows);
}

function parseRowsFromText(text, player, sourceUrl) {
  const lines = buildLines(text);
  const { playerNorm, terms } = buildPlayerTerms(player);
  const rows = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNorm = normalizeName(lines[i]);
    if (!lineNorm) continue;
    if (!(lineNorm.includes(playerNorm) || terms.some(part => part && lineNorm.includes(part)))) continue;

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
      computeNameMatchScore(teamInfo.teamName, playerNorm),
      computeNameMatchScore(lines[i], playerNorm)
    );
    if (!matchScore) continue;

    rows.push({
      eventId: slugify(eventName),
      eventName,
      matchedCurler: teamInfo.matchedCurler,
      matchedTeam: teamInfo.teamName,
      teamName: teamInfo.teamName,
      opponentName: oppInfo.teamName,
      drawLabel: drawLine ? drawLine.replace(/^Draw:\s*/i, '').split('--')[0]?.trim() : null,
      startsAt: timeLine || null,
      epochMs: parseDateish(timeLine || ''),
      gameTitle: '',
      state: finalLine || 'Complete',
      stateLabel: finalLine || 'Complete',
      teamScore: /^\d+$/.test(scoreLine) ? Number(scoreLine) : 0,
      opponentScore: 0,
      result: '',
      matchScore,
      sourceUrl,
      discoveryType: 'scoreboard-text'
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

async function scrapeCurlingZone(player) {
  const cacheKey = normalizeName(player);
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.payload;

  const { terms } = buildPlayerTerms(player);
  const queue = BASES.map(url => ({ url, depth: 0, priority: 0, discoveredFrom: 'base' }));
  const seen = new Set();
  const rows = [];
  const visited = [];

  while (queue.length && seen.size < MAX_PAGES) {
    queue.sort((a, b) => b.priority - a.priority || a.depth - b.depth);
    const next = queue.shift();
    if (!next || !next.url || seen.has(next.url)) continue;
    seen.add(next.url);

    let html = '';
    try {
      html = await fetchText(next.url);
    } catch {
      continue;
    }

    visited.push({ url: next.url, depth: next.depth, discoveredFrom: next.discoveredFrom });
    rows.push(...parseRowsFromText(html, player, next.url));
    rows.push(...rosterRowsFromPage(html, player, next.url));

    const discovered = extractRosterContext(html, next.url, terms);
    for (const link of discovered) {
      if (seen.has(link.href)) continue;
      queue.push({
        url: link.href,
        depth: next.depth + 1,
        priority: link.score,
        discoveredFrom: classifyLink(link.href, link.text).isRoster ? 'roster-link' : 'linked-page'
      });
      if (queue.length >= MAX_PAGES * 2) break;
    }
  }

  const payload = {
    rows: dedupeRows(rows),
    scrapedAt: new Date().toISOString(),
    pagesVisited: seen.size,
    discovery: visited
  };

  searchCache.set(cacheKey, { payload, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });
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
  if (!player) return json(res, 400, { error: 'Missing player parameter' });

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
